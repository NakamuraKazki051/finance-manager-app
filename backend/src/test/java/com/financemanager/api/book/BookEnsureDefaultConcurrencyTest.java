package com.financemanager.api.book;

import com.financemanager.api.TestAuth;
import com.financemanager.api.category.CategoryRepository;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 複数タブ・二重ログインで初期の家計簿作成が同時に走っても、家計簿と初期カテゴリが1組しか作られないことの確認。
 * 各リクエストが実際にコミットされる必要があるため、他のテストと違い @Transactional を付けない。
 */
@SpringBootTest
@AutoConfigureMockMvc
class BookEnsureDefaultConcurrencyTest {

    private static final int CONCURRENT_REQUESTS = 8;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private BookRepository bookRepository;

    @Autowired
    private CategoryRepository categoryRepository;

    @Test
    void concurrentEnsureDefaultCreatesOnlyOneBook() throws Exception {
        MockHttpSession session = TestAuth.registerAndLogin(mockMvc, objectMapper);
        String userId = (String) session.getAttribute("userId");

        ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT_REQUESTS);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> results = new ArrayList<>();
        try {
            for (int i = 0; i < CONCURRENT_REQUESTS; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return mockMvc.perform(post("/api/books/ensure-default").session(session))
                            .andReturn().getResponse().getStatus();
                }));
            }
            start.countDown();
            for (Future<Integer> result : results) {
                assertEquals(200, result.get(30, TimeUnit.SECONDS));
            }
        } finally {
            pool.shutdownNow();
        }

        List<Book> books = bookRepository.findByUserId(userId);
        assertEquals(1, books.size());
        assertEquals(6, categoryRepository.countByBookId(books.get(0).getId()));
    }
}
