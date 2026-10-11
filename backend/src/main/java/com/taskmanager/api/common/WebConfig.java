package com.taskmanager.api.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    // フロントエンドをAPIと別のポートで配信する環境（EC2など）のオリジン。カンマ区切りで完全一致のみ
    // 例: APP_CORS_ALLOWED_ORIGINS=http://203.0.113.10
    @Value("${app.cors.allowed-origins:}")
    private String extraAllowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // Cookie付きのリクエストを許可するため、任意のサイトではなくローカル開発用のオリジンに限定する
        // (「*」だと、ログイン中に開いた外部サイトからタスクを読み書きできてしまう)
        List<String> origins = new ArrayList<>(List.of("http://localhost:*", "http://127.0.0.1:*"));
        Arrays.stream(extraAllowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty() && !origin.contains("*"))
                .forEach(origins::add);

        registry.addMapping("/api/**")
                .allowedOriginPatterns(origins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE")
                .allowCredentials(true);
    }
}
