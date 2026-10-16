package com.financemanager.api.common;

import com.financemanager.api.TestAuth;
import com.financemanager.api.TestData;
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

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 長すぎる値・欠けた値・存在しないURLなどで、500(サーバーエラー)ではなく原因が分かる4xxを返すことを確かめる。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ErrorResponseTest {

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

    private String json(Object value) {
        return data.json(value);
    }

    @Test
    void tooLongBookNameIsRejected() throws Exception {
        mockMvc.perform(post("/api/books").session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "あ".repeat(300)))))
                .andExpect(status().isBadRequest());
        String bookId = data.createBook("家計簿");
        mockMvc.perform(put("/api/books/{id}", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "あ".repeat(300)))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void tooLongCategoryNameIsRejectedOnCreateAndRename() throws Exception {
        String bookId = data.createBook("家計簿");
        mockMvc.perform(post("/api/books/{bookId}/categories", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "あ".repeat(300), "type", "EXPENSE"))))
                .andExpect(status().isBadRequest());
        String categoryId = data.createCategory(bookId, "趣味", "EXPENSE");
        mockMvc.perform(put("/api/categories/{id}", categoryId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "あ".repeat(300)))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void importValidatesEachCategoryAndTransaction() throws Exception {
        String bookId = data.createBook("家計簿");
        Map<String, Object> transactionWithoutAmount = new HashMap<>();
        transactionWithoutAmount.put("categoryId", "c1");
        transactionWithoutAmount.put("date", "2026-10-01");
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of(
                                "categories", List.of(Map.of("id", "c1", "name", "食費", "type", "EXPENSE")),
                                "transactions", List.of(transactionWithoutAmount)))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of(
                                "categories", List.of(Map.of("id", "c1", "name", "食費", "type", "EXPENSE")),
                                "transactions", List.of(Map.of("categoryId", "c1", "amount", 1, "date", "2026-10-01",
                                        "memo", "あ".repeat(300)))))))
                .andExpect(status().isBadRequest());
        Map<String, Object> categoryWithoutName = new HashMap<>();
        categoryWithoutName.put("id", "c1");
        categoryWithoutName.put("type", "EXPENSE");
        mockMvc.perform(put("/api/books/{bookId}/import", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("categories", List.of(categoryWithoutName)))))
                .andExpect(status().isBadRequest());
        // 途中で失敗しても元のカテゴリは消えていない
        mockMvc.perform(get("/api/books/{bookId}/categories", bookId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(6));
    }

    @Test
    void passwordLongerThan72BytesIsRejectedNotServerError() throws Exception {
        // 全角文字は1文字3バイトなので、30文字でも72バイトを超える
        String longPassword = "あ".repeat(30);
        mockMvc.perform(post("/api/users/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "long-pw@example.com", "password", longPassword))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "long-pw@example.com", "password", longPassword))))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(put("/api/users/me").session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", longPassword))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void tooLongEmailIsRejected() throws Exception {
        // @Email は @の前64文字・ドメイン255文字までを許すので、それぞれ範囲内のまま合計でDBの255文字を超えさせる
        String email = "a".repeat(64) + "@" + String.join(".", java.util.Collections.nCopies(4, "b".repeat(60))) + ".com";
        mockMvc.perform(post("/api/users/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", email, "password", "correcthorsebattery"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void invalidQueryParameterIsBadRequest() throws Exception {
        String bookId = data.createBook("家計簿");
        mockMvc.perform(get("/api/books/{bookId}/transactions", bookId).session(session).param("month", "2026-13"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/books/{bookId}/transactions", bookId).session(session).param("maxAmount", "たくさん"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void unknownPathIsNotFoundAndWrongMethodIsMethodNotAllowed() throws Exception {
        mockMvc.perform(get("/api/does-not-exist").session(session))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/favicon.ico"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/transactions/some-id/move").session(session))
                .andExpect(status().isMethodNotAllowed());
    }
}
