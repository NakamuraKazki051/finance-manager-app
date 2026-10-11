package com.taskmanager.api.common;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "app.cors.allowed-origins=http://203.0.113.10, http://*.example.com")
@AutoConfigureMockMvc
class CorsAllowedOriginsTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void configuredOriginIsAllowedWithCredentials() throws Exception {
        mockMvc.perform(options("/api/boards")
                        .header("Origin", "http://203.0.113.10")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://203.0.113.10"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }

    @Test
    void localOriginsAreStillAllowed() throws Exception {
        mockMvc.perform(options("/api/boards")
                        .header("Origin", "http://localhost:5500")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk());
    }

    @Test
    void otherPortsOnConfiguredHostAndWildcardsAreRejected() throws Exception {
        mockMvc.perform(options("/api/boards")
                        .header("Origin", "http://203.0.113.10:3000")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());

        // ワイルドカードは無視する（Cookie付き通信を広い範囲に許可しないため）
        mockMvc.perform(options("/api/boards")
                        .header("Origin", "http://evil.example.com")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());
    }
}
