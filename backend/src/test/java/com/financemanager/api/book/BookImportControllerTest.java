package com.financemanager.api.book;

import com.financemanager.api.TestAuth;
import com.financemanager.api.TestData;
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
class BookImportControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private MockHttpSession session;
    private TestData data;

    @BeforeEach
    void logIn() throws Exception {
        session = TestAuth.registerAndLogin(mockMvc, objectMapper);
        data = new TestData(mockMvc, objectMapper, session);
    }

    private Map<String, Object> sampleBackup() {
        return Map.of(
                "categories", List.of(
                        Map.of("id", "old-income", "name", "給与", "type", "INCOME"),
                        Map.of("id", "old-food", "name", "食費", "type", "EXPENSE")),
                "transactions", List.of(
                        Map.of("categoryId", "old-income", "amount", 250000, "date", "2026-10-25", "memo", "10月分"),
                        Map.of("categoryId", "old-food", "amount", 1200, "date", "2026-10-03", "tags", List.of("外食"))));
    }

    @Test
    void replacesCategoriesAndTransactionsOfBook() throws Exception {
        String bookId = data.createBook("家計簿");
        String oldCategory = data.categories(bookId).get(1).get("id").asText();
        data.createTransaction(bookId, oldCategory, 999, "2026-10-01");

        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(sampleBackup())))
                .andExpect(status().isNoContent());

        JsonNode categories = data.categories(bookId);
        assertEquals(2, categories.size());
        assertEquals("給与", categories.get(0).get("name").asText());
        String body = mockMvc.perform(get("/api/books/{bookId}/transactions", bookId).session(session))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode transactions = data.read(body);
        assertEquals(2, transactions.size());
        // カテゴリIDは新しく振り直され、取引はそちらを指す
        assertEquals(categories.get(0).get("id").asText(), transactions.get(0).get("categoryId").asText());
        assertEquals(250000, transactions.get(0).get("amount").asLong());
        assertEquals("外食", transactions.get(1).get("tags").get(0).asText());
    }

    @Test
    void rejectsTransactionReferencingUnknownCategory() throws Exception {
        String bookId = data.createBook("家計簿");
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(data.json(Map.of(
                                "categories", List.of(Map.of("id", "c1", "name", "食費", "type", "EXPENSE")),
                                "transactions", List.of(Map.of("categoryId", "missing", "amount", 100, "date", "2026-10-01"))))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsInvalidAmountOrMissingType() throws Exception {
        String bookId = data.createBook("家計簿");
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(data.json(Map.of(
                                "categories", List.of(Map.of("id", "c1", "name", "食費", "type", "EXPENSE")),
                                "transactions", List.of(Map.of("categoryId", "c1", "amount", 0, "date", "2026-10-01"))))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(data.json(Map.of("categories", List.of(Map.of("id", "c1", "name", "食費"))))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void importingForUnknownBookFails() throws Exception {
        mockMvc.perform(put("/api/books/{bookId}/import", "no-such-book").session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(sampleBackup())))
                .andExpect(status().isNotFound());
    }

    @Test
    void cannotImportIntoAnotherUsersBook() throws Exception {
        String bookId = data.createBook("家計簿");
        MockHttpSession other = TestAuth.registerAndLogin(mockMvc, objectMapper);
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(other)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(sampleBackup())))
                .andExpect(status().isNotFound());
        assertEquals(6, data.categories(bookId).size());
    }
}
