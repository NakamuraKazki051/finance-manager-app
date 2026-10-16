package com.financemanager.api.book;

import com.financemanager.api.TestAuth;
import com.financemanager.api.TestData;
import com.financemanager.api.category.CategoryRepository;
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

import java.util.Map;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class BookControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private CategoryRepository categoryRepository;

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
    void requiresLogin() throws Exception {
        mockMvc.perform(get("/api/books")).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", "x"))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void createdBookHasDefaultCategories() throws Exception {
        String bookId = data.createBook("生活費");

        mockMvc.perform(get("/api/books").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name").value("生活費"));
        JsonNode categories = data.categories(bookId);
        assertEquals(6, categories.size());
        assertEquals("給与", categories.get(0).get("name").asText());
        assertEquals("INCOME", categories.get(0).get("type").asText());
        assertEquals("EXPENSE", categories.get(1).get("type").asText());
    }

    @Test
    void usersOnlySeeOwnBooks() throws Exception {
        data.createBook("自分の家計簿");
        MockHttpSession other = TestAuth.registerAndLogin(mockMvc, objectMapper);
        mockMvc.perform(get("/api/books").session(other))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void cannotRenameOrDeleteAnotherUsersBook() throws Exception {
        String bookId = data.createBook("自分の家計簿");
        data.createBook("予備");
        MockHttpSession other = TestAuth.registerAndLogin(mockMvc, objectMapper);
        mockMvc.perform(put("/api/books/{id}", bookId).session(other)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", "乗っ取り"))))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/books/{id}", bookId).session(other))
                .andExpect(status().isNotFound());
    }

    @Test
    void rejectsBlankName() throws Exception {
        mockMvc.perform(post("/api/books").session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", " "))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void renamesBook() throws Exception {
        String bookId = data.createBook("旧名");
        mockMvc.perform(put("/api/books/{id}", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("name", " 新名 "))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("新名"));
    }

    @Test
    void deletesBookUnlessLastOne() throws Exception {
        String first = data.createBook("1冊目");
        mockMvc.perform(delete("/api/books/{id}", first).session(session))
                .andExpect(status().isBadRequest());
        data.createBook("2冊目");
        mockMvc.perform(delete("/api/books/{id}", first).session(session))
                .andExpect(status().isNoContent());
    }

    @Test
    void deletingBookAlsoDeletesItsCategoriesAndTransactions() throws Exception {
        String bookId = data.createBook("消す家計簿");
        data.createBook("残す家計簿");
        String categoryId = data.categories(bookId).get(1).get("id").asText();
        data.createTransaction(bookId, categoryId, 500, "2026-10-01");

        mockMvc.perform(delete("/api/books/{id}", bookId).session(session))
                .andExpect(status().isNoContent());

        assertEquals(0, categoryRepository.countByBookId(bookId));
        assertEquals(0, transactionRepository.findByBookId(bookId).size());
    }

    @Test
    void ensureDefaultCreatesOneBookWithDefaultCategoriesOnlyOnce() throws Exception {
        String body = mockMvc.perform(post("/api/books/ensure-default").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name").value("家計簿"))
                .andReturn().getResponse().getContentAsString();
        String bookId = data.read(body).get(0).get("id").asText();
        assertEquals(6, data.categories(bookId).size());

        mockMvc.perform(post("/api/books/ensure-default").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));
        assertEquals(6, data.categories(bookId).size());
    }

    @Test
    void ensureDefaultLeavesExistingBooksAlone() throws Exception {
        data.createBook("既存");
        mockMvc.perform(post("/api/books/ensure-default").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name").value("既存"));
    }

    @Test
    void ensureDefaultRequiresLogin() throws Exception {
        mockMvc.perform(post("/api/books/ensure-default")).andExpect(status().isUnauthorized());
    }

    @Test
    void deletingUnknownBookReturnsNotFound() throws Exception {
        mockMvc.perform(delete("/api/books/{id}", "no-such-book").session(session))
                .andExpect(status().isNotFound());
    }

    @Test
    void malformedJsonBodyReturnsBadRequestNotServerError() throws Exception {
        mockMvc.perform(post("/api/books").session(session)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":"))
                .andExpect(status().isBadRequest());
    }
}
