package com.financemanager.api.auth;

import com.financemanager.api.TestAuth;
import com.financemanager.api.user.UserRepository;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * ログイン・アカウントまわりの細かな穴(同時登録・パスワード変更後のセッション・応答時間の差)の確認。
 * 同時登録はリクエストごとに実際にコミットされる必要があるため、@Transactional を付けない。
 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthHardeningTest {

    private static final String PASSWORD = "correcthorsebattery";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserRepository userRepository;

    @MockitoSpyBean
    private PasswordEncoder passwordEncoder;

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    private MockHttpSession login(String email, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", email, "password", password))))
                .andExpect(status().isOk())
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession();
    }

    @Test
    void concurrentRegistrationWithSameEmailReturnsConflictNotServerError() throws Exception {
        String email = "race-" + UUID.randomUUID() + "@example.com";
        int threads = 6;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> results = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return mockMvc.perform(post("/api/users/register")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(json(Map.of("email", email, "password", PASSWORD))))
                            .andReturn().getResponse().getStatus();
                }));
            }
            start.countDown();
            int created = 0;
            for (Future<Integer> result : results) {
                int code = result.get(60, TimeUnit.SECONDS);
                if (code == 201) {
                    created++;
                } else {
                    assertEquals(409, code);
                }
            }
            assertEquals(1, created);
        } finally {
            pool.shutdownNow();
            userRepository.findByEmail(email).ifPresent(userRepository::delete);
        }
    }

    @Test
    void changingPasswordLogsOutOtherSessionsButKeepsCurrentOne() throws Exception {
        MockHttpSession phone = TestAuth.registerAndLogin(mockMvc, objectMapper);
        String email = objectMapper.readTree(mockMvc.perform(get("/api/auth/me").session(phone))
                .andReturn().getResponse().getContentAsString()).get("email").asText();
        MockHttpSession laptop = login(email, "correcthorsebattery");
        try {
            mockMvc.perform(put("/api/users/me").session(laptop)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("currentPassword", "correcthorsebattery", "newPassword", "newpassword123"))))
                    .andExpect(status().isOk());

            mockMvc.perform(get("/api/auth/me").session(laptop)).andExpect(status().isOk());
            mockMvc.perform(get("/api/books").session(laptop)).andExpect(status().isOk());
            mockMvc.perform(get("/api/books").session(phone)).andExpect(status().isUnauthorized());
            mockMvc.perform(get("/api/auth/me").session(phone)).andExpect(status().isUnauthorized());
        } finally {
            userRepository.findByEmail(email).ifPresent(userRepository::delete);
        }
    }

    @Test
    void changingOnlyEmailKeepsOtherSessions() throws Exception {
        MockHttpSession phone = TestAuth.registerAndLogin(mockMvc, objectMapper);
        String email = objectMapper.readTree(mockMvc.perform(get("/api/auth/me").session(phone))
                .andReturn().getResponse().getContentAsString()).get("email").asText();
        MockHttpSession laptop = login(email, "correcthorsebattery");
        String newEmail = "changed-" + UUID.randomUUID() + "@example.com";
        try {
            mockMvc.perform(put("/api/users/me").session(laptop)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("email", newEmail, "currentPassword", "correcthorsebattery"))))
                    .andExpect(status().isOk());
            mockMvc.perform(get("/api/books").session(phone)).andExpect(status().isOk());
        } finally {
            userRepository.findByEmail(newEmail).ifPresent(userRepository::delete);
        }
    }

    @Test
    void loginWithUnknownEmailStillChecksAPassword() throws Exception {
        // パスワード照合(BCrypt)は意図的に遅い。未登録のときだけ照合を省くと、応答の速さで登録の有無が分かってしまう
        clearInvocations(passwordEncoder);
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "nobody-" + UUID.randomUUID() + "@example.com", "password", PASSWORD))))
                .andExpect(status().isUnauthorized());
        verify(passwordEncoder).matches(any(), anyString());
    }
}
