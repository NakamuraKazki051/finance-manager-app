package com.financemanager.api.category;

import com.financemanager.api.TestAuth;
import com.financemanager.api.TestData;
import com.financemanager.api.transaction.TransactionRepository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CategoryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private TransactionRepository transactionRepository;

    private MockHttpSession session;
    private TestData data;

    @BeforeEach
    void logIn() throws Exception {
        session = TestAuth.registerAndLogin(mockMvc, objectMapper);
        data = new TestData(mockMvc, objectMapper, session);
    }

    @Test
    void createsListsAndUpdatesCategory() throws Exception {
        String bookId = data.createBook("家計簿");
        String categoryId = data.createCategory(bookId, "副業", "INCOME");

        JsonNode categories = data.categories(bookId);
        assertEquals(7, categories.size());
        assertEquals("副業", categories.get(6).get("name").asText());
        assertEquals(6, categories.get(6).get("displayOrder").asInt());

        mockMvc.perform(put("/api/categories/{id}", categoryId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(data.json(Map.of("name", "お小遣い", "type", "EXPENSE"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("お小遣い"))
                .andExpect(jsonPath("$.type").value("EXPENSE"));
    }

    @Test
    void rejectsMissingOrUnknownType() throws Exception {
        String bookId = data.createBook("家計簿");
        mockMvc.perform(post("/api/books/{bookId}/categories", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", "種別なし"))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/books/{bookId}/categories", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", "x", "type", "LOAN"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void creatingCategoryForUnknownBookFails() throws Exception {
        mockMvc.perform(post("/api/books/{bookId}/categories", "no-such-book").session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", "x", "type", "EXPENSE"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void cannotDeleteLastCategory() throws Exception {
        String bookId = data.createBook("家計簿");
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(data.json(Map.of("categories", List.of(Map.of("id", "c1", "name", "食費", "type", "EXPENSE"))))))
                .andExpect(status().isNoContent());
        String onlyId = data.categories(bookId).get(0).get("id").asText();
        mockMvc.perform(delete("/api/categories/{id}", onlyId).session(session))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deletingCategoryAlsoDeletesItsTransactionsAndRenumbers() throws Exception {
        String bookId = data.createBook("家計簿");
        JsonNode before = data.categories(bookId);
        String food = before.get(1).get("id").asText();
        String daily = before.get(2).get("id").asText();
        data.createTransaction(bookId, food, 800, "2026-10-01");
        data.createTransaction(bookId, food, 1200, "2026-10-02");
        String kept = data.createTransaction(bookId, daily, 300, "2026-10-02");

        mockMvc.perform(delete("/api/categories/{id}", food).session(session))
                .andExpect(status().isNoContent());

        assertEquals(0, transactionRepository.countByCategoryId(food));
        assertEquals(1, transactionRepository.findByBookId(bookId).size());
        assertEquals(kept, transactionRepository.findByBookId(bookId).get(0).getId());
        JsonNode after = data.categories(bookId);
        assertEquals(5, after.size());
        for (int i = 0; i < after.size(); i++) {
            assertEquals(i, after.get(i).get("displayOrder").asInt());
        }
    }

    @Test
    void cannotListUpdateMoveOrDeleteAnotherUsersCategory() throws Exception {
        String bookId = data.createBook("家計簿");
        String categoryId = data.categories(bookId).get(0).get("id").asText();
        MockHttpSession other = TestAuth.registerAndLogin(mockMvc, objectMapper);

        mockMvc.perform(get("/api/books/{bookId}/categories", bookId).session(other))
                .andExpect(status().isNotFound());
        mockMvc.perform(put("/api/categories/{id}", categoryId).session(other)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", "乗っ取り"))))
                .andExpect(status().isNotFound());
        mockMvc.perform(patch("/api/categories/{id}/move", categoryId).session(other)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("displayOrder", 3))))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/categories/{id}", categoryId).session(other))
                .andExpect(status().isNotFound());
        assertEquals("給与", data.categories(bookId).get(0).get("name").asText());
    }

    @Test
    void categoryEndpointsRequireLogin() throws Exception {
        mockMvc.perform(get("/api/books/{bookId}/categories", "any")).andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/categories/{id}", "any")).andExpect(status().isUnauthorized());
    }

    @Test
    void movesCategoryOrder() throws Exception {
        String bookId = data.createBook("家計簿");
        String last = data.categories(bookId).get(5).get("id").asText();
        mockMvc.perform(patch("/api/categories/{id}/move", last).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("displayOrder", 0))))
                .andExpect(status().isOk());
        JsonNode after = data.categories(bookId);
        assertEquals(last, after.get(0).get("id").asText());
        assertEquals("給与", after.get(1).get("name").asText());
    }
}
