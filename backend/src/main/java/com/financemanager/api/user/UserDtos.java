package com.financemanager.api.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public class UserDtos {

    private UserDtos() {
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 255, message = "メールアドレスは255文字以内で入力してください") String email,
            // BCrypt only accepts up to 72 bytes; multi-byte passwords are additionally checked in PasswordEncoderConfig
            @NotBlank @Size(min = 8, max = 72, message = "パスワードは8〜72文字で入力してください") String password
    ) {
    }

    public record UpdateRequest(
            @Email @Size(max = 255, message = "メールアドレスは255文字以内で入力してください") String email,
            @NotBlank String currentPassword,
            @Size(min = 8, max = 72, message = "パスワードは8〜72文字で入力してください") String newPassword
    ) {
    }

    public record UserResponse(String id, String email, Instant createdAt) {
        public static UserResponse from(User user) {
            return new UserResponse(user.getId(), user.getEmail(), user.getCreatedAt());
        }
    }
}
