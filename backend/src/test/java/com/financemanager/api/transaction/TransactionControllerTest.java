package com.financemanager.api.transaction;

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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class TransactionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private MockHttpSession session;
    private TestData data;
    private String bookId;
    private String salary;
    private String food;
    private String daily;

    @BeforeEach
    void setUp() throws Exception {
        session = TestAuth.registerAndLogin(mockMvc, objectMapper);
        data = new TestData(mockMvc, objectMapper, session);
        bookId = data.createBook("家計簿");
        JsonNode categories = data.categories(bookId);
        salary = categories.get(0).get("id").asText();
        food = categories.get(1).get("id").asText();
        daily = categories.get(2).get("id").asText();
    }

    private JsonNode list(MockHttpServletRequestBuilder request) throws Exception {
        String body = mockMvc.perform(request.session(session))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return data.read(body);
    }

    private List<Long> amounts(JsonNode transactions) {
        List<Long> result = new ArrayList<>();
        transactions.forEach(t -> result.add(t.get("amount").asLong()));
        return result;
    }

    private Map<String, Object> payload(String categoryId, Object amount, String date) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("categoryId", categoryId);
        payload.put("amount", amount);
        payload.put("date", date);
        return payload;
    }

    @Test
    void createsAndReadsTransaction() throws Exception {
        String id = data.createTransaction(bookId, food, 1280, "2026-10-16",
                Map.of("memo", " ランチ ", "tags", List.of("外食", "仕事")));

        mockMvc.perform(get("/api/transactions/{id}", id).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.amount").value(1280))
                .andExpect(jsonPath("$.date").value("2026-10-16"))
                .andExpect(jsonPath("$.categoryId").value(food))
                .andExpect(jsonPath("$.memo").value("ランチ"))
                .andExpect(jsonPath("$.tags", hasSize(2)))
                .andExpect(jsonPath("$.createdAt").exists());
    }

    @Test
    void rejectsInvalidAmountDateAndMemo() throws Exception {
        for (Object amount : new Object[]{0, -100, 100_000_000L}) {
            mockMvc.perform(post("/api/books/{bookId}/transactions", bookId).session(session)
                            .contentType(MediaType.APPLICATION_JSON).content(data.json(payload(food, amount, "2026-10-01"))))
                    .andExpect(status().isBadRequest());
        }
        Map<String, Object> noAmount = payload(food, null, "2026-10-01");
        Map<String, Object> noDate = payload(food, 100, null);
        Map<String, Object> badDate = payload(food, 100, "2026-02-30");
        Map<String, Object> longMemo = payload(food, 100, "2026-10-01");
        longMemo.put("memo", "あ".repeat(101));
        Map<String, Object> longTag = payload(food, 100, "2026-10-01");
        longTag.put("tags", List.of("あ".repeat(31)));
        for (Map<String, Object> invalid : List.of(noAmount, noDate, badDate, longMemo, longTag)) {
            mockMvc.perform(post("/api/books/{bookId}/transactions", bookId).session(session)
                            .contentType(MediaType.APPLICATION_JSON).content(data.json(invalid)))
                    .andExpect(status().isBadRequest());
        }
        // 上限ちょうどは登録できる
        data.createTransaction(bookId, food, 99_999_999L, "2026-10-01");
        assertEquals(1, list(get("/api/books/{bookId}/transactions", bookId)).size());
    }

    @Test
    void creatingTransactionWithCategoryFromAnotherBookFails() throws Exception {
        String otherBook = data.createBook("別の家計簿");
        String otherCategory = data.categories(otherBook).get(1).get("id").asText();
        mockMvc.perform(post("/api/books/{bookId}/transactions", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(payload(otherCategory, 100, "2026-10-01"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void monthFilterIncludesFirstAndLastDayOnly() throws Exception {
        data.createTransaction(bookId, food, 1, "2026-09-30");
        data.createTransaction(bookId, food, 2, "2026-10-01");
        data.createTransaction(bookId, food, 3, "2026-10-31");
        data.createTransaction(bookId, food, 4, "2026-11-01");

        JsonNode october = list(get("/api/books/{bookId}/transactions", bookId).param("month", "2026-10"));
        assertEquals(List.of(3L, 2L), amounts(october));
        assertEquals(4, list(get("/api/books/{bookId}/transactions", bookId)).size());
    }

    @Test
    void monthFilterHandlesLeapDay() throws Exception {
        data.createTransaction(bookId, food, 29, "2028-02-29");
        data.createTransaction(bookId, food, 1, "2028-03-01");
        assertEquals(List.of(29L), amounts(list(get("/api/books/{bookId}/transactions", bookId).param("month", "2028-02"))));
    }

    @Test
    void invalidMonthOrSortIsBadRequest() throws Exception {
        for (String month : List.of("2026-13", "2026/10", "abc")) {
            mockMvc.perform(get("/api/books/{bookId}/transactions", bookId).session(session).param("month", month))
                    .andExpect(status().isBadRequest());
            mockMvc.perform(get("/api/books/{bookId}/summary", bookId).session(session).param("month", month))
                    .andExpect(status().isBadRequest());
        }
        mockMvc.perform(get("/api/books/{bookId}/transactions", bookId).session(session).param("sort", "random"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/books/{bookId}/transactions", bookId).session(session).param("minAmount", "many"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void filtersByTagMemoAndAmountRange() throws Exception {
        data.createTransaction(bookId, food, 500, "2026-10-01", Map.of("memo", "コンビニ", "tags", List.of("間食")));
        data.createTransaction(bookId, food, 3000, "2026-10-02", Map.of("memo", "居酒屋", "tags", List.of("外食")));
        data.createTransaction(bookId, daily, 1500, "2026-10-03", Map.of("memo", "ドラッグストア"));

        assertEquals(List.of(3000L), amounts(list(get("/api/books/{bookId}/transactions", bookId).param("tag", "外食"))));
        assertEquals(List.of(500L), amounts(list(get("/api/books/{bookId}/transactions", bookId).param("q", "コンビ"))));
        assertEquals(List.of(1500L), amounts(list(get("/api/books/{bookId}/transactions", bookId)
                .param("minAmount", "1000").param("maxAmount", "2000"))));
    }

    @Test
    void sortsByDateNewestFirstOrByAmount() throws Exception {
        data.createTransaction(bookId, food, 300, "2026-10-05");
        data.createTransaction(bookId, food, 100, "2026-10-20");
        data.createTransaction(bookId, food, 200, "2026-10-10");

        assertEquals(List.of(100L, 200L, 300L), amounts(list(get("/api/books/{bookId}/transactions", bookId))));
        assertEquals(List.of(300L, 200L, 100L), amounts(list(get("/api/books/{bookId}/transactions", bookId).param("sort", "amount"))));
    }

    @Test
    void updatesMovesAndDeletesTransaction() throws Exception {
        String id = data.createTransaction(bookId, food, 1000, "2026-10-01", Map.of("memo", "メモ"));

        Map<String, Object> update = payload(daily, 2500, "2026-11-02");
        update.put("memo", "");
        mockMvc.perform(put("/api/transactions/{id}", id).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(update)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.amount").value(2500))
                .andExpect(jsonPath("$.date").value("2026-11-02"))
                .andExpect(jsonPath("$.categoryId").value(daily))
                .andExpect(jsonPath("$.memo").value(nullValue()));

        mockMvc.perform(patch("/api/transactions/{id}/move", id).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("categoryId", food))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.categoryId").value(food))
                .andExpect(jsonPath("$.amount").value(2500));

        mockMvc.perform(delete("/api/transactions/{id}", id).session(session))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/transactions/{id}", id).session(session))
                .andExpect(status().isNotFound());
    }

    @Test
    void movingToCategoryFromAnotherBookFails() throws Exception {
        String id = data.createTransaction(bookId, food, 1000, "2026-10-01");
        String otherBook = data.createBook("別の家計簿");
        String otherCategory = data.categories(otherBook).get(1).get("id").asText();
        mockMvc.perform(patch("/api/transactions/{id}/move", id).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("categoryId", otherCategory))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void cannotTouchAnotherUsersTransactions() throws Exception {
        String id = data.createTransaction(bookId, food, 1000, "2026-10-01");
        MockHttpSession other = TestAuth.registerAndLogin(mockMvc, objectMapper);

        mockMvc.perform(get("/api/books/{bookId}/transactions", bookId).session(other)).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/books/{bookId}/summary", bookId).session(other).param("month", "2026-10"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/transactions/{id}", id).session(other)).andExpect(status().isNotFound());
        mockMvc.perform(put("/api/transactions/{id}", id).session(other)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(payload(food, 1, "2026-10-01"))))
                .andExpect(status().isNotFound());
        mockMvc.perform(patch("/api/transactions/{id}/move", id).session(other)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("categoryId", daily))))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/transactions/{id}", id).session(other)).andExpect(status().isNotFound());
        mockMvc.perform(post("/api/books/{bookId}/transactions/bulk-delete", bookId).session(other)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("transactionIds", List.of(id)))))
                .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/transactions/{id}", id).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.amount").value(1000));
    }

    @Test
    void transactionEndpointsRequireLogin() throws Exception {
        mockMvc.perform(get("/api/books/{bookId}/transactions", bookId)).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/books/{bookId}/summary", bookId).param("month", "2026-10")).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/books/{bookId}/transactions", bookId)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(payload(food, 1, "2026-10-01"))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void bulkDeletesTransactions() throws Exception {
        String a = data.createTransaction(bookId, food, 1, "2026-10-01");
        String b = data.createTransaction(bookId, daily, 2, "2026-10-01");
        data.createTransaction(bookId, daily, 3, "2026-10-01");

        mockMvc.perform(post("/api/books/{bookId}/transactions/bulk-delete", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("transactionIds", List.of(a, b)))))
                .andExpect(status().isNoContent());
        assertEquals(List.of(3L), amounts(list(get("/api/books/{bookId}/transactions", bookId))));
    }

    @Test
    void bulkDeleteRejectsForeignTransactionsWithoutDeletingAnything() throws Exception {
        String mine = data.createTransaction(bookId, food, 1, "2026-10-01");
        String otherBook = data.createBook("別の家計簿");
        String otherCategory = data.categories(otherBook).get(1).get("id").asText();
        String foreign = data.createTransaction(otherBook, otherCategory, 2, "2026-10-01");

        mockMvc.perform(post("/api/books/{bookId}/transactions/bulk-delete", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("transactionIds", List.of(mine, foreign)))))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/books/{bookId}/transactions/bulk-delete", bookId).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("transactionIds", List.of(mine, "missing")))))
                .andExpect(status().isNotFound());
        assertEquals(1, list(get("/api/books/{bookId}/transactions", bookId)).size());
        assertEquals(1, list(get("/api/books/{bookId}/transactions", otherBook)).size());
    }

    @Test
    void summaryTotalsIncomeExpenseAndBalanceForTheMonth() throws Exception {
        data.createTransaction(bookId, salary, 250_000, "2026-10-25");
        data.createTransaction(bookId, food, 1_200, "2026-10-01");
        data.createTransaction(bookId, food, 800, "2026-10-31");
        data.createTransaction(bookId, daily, 3_000, "2026-10-15");
        // 前後の月は含めない
        data.createTransaction(bookId, food, 99_999, "2026-09-30");
        data.createTransaction(bookId, salary, 99_999, "2026-11-01");

        mockMvc.perform(get("/api/books/{bookId}/summary", bookId).session(session).param("month", "2026-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.month").value("2026-10"))
                .andExpect(jsonPath("$.income").value(250_000))
                .andExpect(jsonPath("$.expense").value(5_000))
                .andExpect(jsonPath("$.balance").value(245_000))
                .andExpect(jsonPath("$.count").value(4))
                // 取引の無いカテゴリも0円で、カテゴリの並び順どおりに返す
                .andExpect(jsonPath("$.categories", hasSize(6)))
                .andExpect(jsonPath("$.categories[0].categoryId").value(salary))
                .andExpect(jsonPath("$.categories[1].total").value(2_000))
                .andExpect(jsonPath("$.categories[1].count").value(2))
                .andExpect(jsonPath("$.categories[3].total").value(0));
    }

    @Test
    void summaryBalanceCanBeNegativeAndFollowsCategoryType() throws Exception {
        data.createTransaction(bookId, food, 5_000, "2026-10-01");
        mockMvc.perform(get("/api/books/{bookId}/summary", bookId).session(session).param("month", "2026-10"))
                .andExpect(jsonPath("$.balance").value(-5_000));

        // カテゴリを収入に変えると、そのカテゴリの取引は収入として集計される
        mockMvc.perform(put("/api/categories/{id}", food).session(session)
                        .contentType(MediaType.APPLICATION_JSON).content(data.json(Map.of("type", "INCOME"))))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/books/{bookId}/summary", bookId).session(session).param("month", "2026-10"))
                .andExpect(jsonPath("$.income").value(5_000))
                .andExpect(jsonPath("$.expense").value(0))
                .andExpect(jsonPath("$.balance").value(5_000));
    }

    @Test
    void summaryRequiresMonth() throws Exception {
        mockMvc.perform(get("/api/books/{bookId}/summary", bookId).session(session))
                .andExpect(status().isBadRequest());
    }
}
