package com.financemanager.api.common;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.nio.charset.StandardCharsets;

@Configuration
public class PasswordEncoderConfig {

    // BCryptは72バイトを超える入力で例外を投げる。全角文字は1文字3バイトなので、72文字以内でも超えることがある
    static final int BCRYPT_MAX_BYTES = 72;

    @Bean
    public PasswordEncoder passwordEncoder() {
        BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();
        return new PasswordEncoder() {
            @Override
            public String encode(CharSequence rawPassword) {
                if (exceedsLimit(rawPassword)) {
                    throw ApiException.badRequest("パスワードが長すぎます(72バイトまで。全角文字は1文字3バイト)");
                }
                return bcrypt.encode(rawPassword);
            }

            @Override
            public boolean matches(CharSequence rawPassword, String encodedPassword) {
                // 72バイトを超えるパスワードは登録できないので、一致することはない
                return !exceedsLimit(rawPassword) && bcrypt.matches(rawPassword, encodedPassword);
            }
        };
    }

    private static boolean exceedsLimit(CharSequence rawPassword) {
        return rawPassword != null
                && rawPassword.toString().getBytes(StandardCharsets.UTF_8).length > BCRYPT_MAX_BYTES;
    }
}
