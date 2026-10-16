package com.financemanager.api.user;

import com.financemanager.api.auth.CurrentUser;
import com.financemanager.api.common.ApiException;
import com.financemanager.api.user.UserDtos.RegisterRequest;
import com.financemanager.api.user.UserDtos.UpdateRequest;
import com.financemanager.api.user.UserDtos.UserResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final CurrentUser currentUser;

    public UserController(UserRepository userRepository, PasswordEncoder passwordEncoder, CurrentUser currentUser) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.currentUser = currentUser;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserResponse register(@Valid @RequestBody RegisterRequest request) {
        String email = request.email().trim().toLowerCase();
        if (userRepository.existsByEmail(email)) {
            throw ApiException.conflict("このメールアドレスは既に登録されています: " + email);
        }
        User user = new User(email, passwordEncoder.encode(request.password()));
        return UserResponse.from(saveOrConflict(user));
    }

    // 上の存在チェックとこの保存の間に同じメールアドレスが登録されると一意制約違反になる。その場合も409で返す
    private User saveOrConflict(User user) {
        try {
            return userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict("このメールアドレスは既に登録されています: " + user.getEmail());
        }
    }

    @PutMapping("/me")
    public UserResponse updateMe(@Valid @RequestBody UpdateRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> ApiException.unauthorized("ログインしていません"));

        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw ApiException.badRequest("現在のパスワードが正しくありません");
        }

        if (request.email() != null && !request.email().isBlank()) {
            String email = request.email().trim().toLowerCase();
            if (!email.equals(user.getEmail()) && userRepository.existsByEmail(email)) {
                throw ApiException.conflict("このメールアドレスは既に登録されています: " + email);
            }
            user.setEmail(email);
        }

        boolean passwordChanged = request.newPassword() != null && !request.newPassword().isBlank();
        if (passwordChanged) {
            user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        }

        User saved = saveOrConflict(user);
        if (passwordChanged) {
            // 他の端末のセッションはパスワード不一致で切れる。変更した本人のセッションだけ新しいパスワードで維持する
            currentUser.signIn(httpRequest, saved);
        }
        return UserResponse.from(saved);
    }
}
