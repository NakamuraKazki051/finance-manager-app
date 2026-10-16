package com.financemanager.api.common;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class StaticResourceCacheFilterTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void frontendFilesMustBeRevalidatedSoUpdatesAreNotHiddenByBrowserCache() throws Exception {
        for (String path : new String[] {"/app.js", "/style.css", "/index.html"}) {
            mockMvc.perform(get(path))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-cache"));
        }
    }

    @Test
    void apiResponsesAreNotTouched() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("Cache-Control"));
    }
}
