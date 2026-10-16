package com.financemanager.api;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** テスト用に家計簿・カテゴリ・取引をAPI経由で作るヘルパー */
public class TestData {

    private final MockMvc mockMvc;
    private final ObjectMapper objectMapper;
    private final MockHttpSession session;

    public TestData(MockMvc mockMvc, ObjectMapper objectMapper, MockHttpSession session) {
        this.mockMvc = mockMvc;
        this.objectMapper = objectMapper;
        this.session = session;
    }

    public String json(Object value) {
        return objectMapper.writeValueAsString(value);
    }

    public JsonNode read(String body) {
        return objectMapper.readTree(body);
    }

    /** 家計簿を作る(初期カテゴリも一緒に作られる) */
    public String createBook(String name) throws Exception {
        String body = mockMvc.perform(post("/api/books").session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", name))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return read(body).get("id").asText();
    }

    public String createCategory(String bookId, String name, String type) throws Exception {
        String body = mockMvc.perform(post("/api/books/{bookId}/categories", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", name, "type", type))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return read(body).get("id").asText();
    }

    public String createTransaction(String bookId, String categoryId, long amount, String date) throws Exception {
        return createTransaction(bookId, categoryId, amount, date, Map.of());
    }

    public String createTransaction(String bookId, String categoryId, long amount, String date, Map<String, Object> extra) throws Exception {
        Map<String, Object> payload = new HashMap<>(extra);
        payload.put("categoryId", categoryId);
        payload.put("amount", amount);
        payload.put("date", date);
        String body = mockMvc.perform(post("/api/books/{bookId}/transactions", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(payload)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return read(body).get("id").asText();
    }

    public JsonNode categories(String bookId) throws Exception {
        String body = mockMvc.perform(get("/api/books/{bookId}/categories", bookId).session(session))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return read(body);
    }
}
