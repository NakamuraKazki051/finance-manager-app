package com.financemanager.api.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 同梱しているフロントエンド(index.html / app.js / style.css)に Cache-Control: no-cache を付ける。
 * 付けないとブラウザが独自の判断でキャッシュし、アップデート後も古いJS/CSSのまま動いてしまう
 * (新しいAPIを呼ばない古いapp.jsが残るなど)。no-cache でも304による再検証が効くので転送量はほぼ増えない。
 */
@Component
public class StaticResourceCacheFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!request.getRequestURI().startsWith("/api/")) {
            response.setHeader("Cache-Control", "no-cache");
        }
        chain.doFilter(request, response);
    }
}
