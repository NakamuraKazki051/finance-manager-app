package com.financemanager.api.auth;

import com.financemanager.api.auth.AuthDtos.LoginRequest;
import com.financemanager.api.common.ApiException;
import com.financemanager.api.user.User;
import com.financemanager.api.user.UserDtos.UserResponse;
import com.financemanager.api.user.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final CurrentUser currentUser;

    // 未登録のメールアドレスでも照合に使うダミーのハッシュ
    private final String dummyPasswordHash;

    public AuthController(UserRepository userRepository, PasswordEncoder passwordEncoder, CurrentUser currentUser) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.currentUser = currentUser;
        this.dummyPasswordHash = passwordEncoder.encode(UUID.randomUUID().toString());
    }

    @PostMapping("/login")
    public UserResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        String email = request.email().trim().toLowerCase();
        Optional<User> found = userRepository.findByEmail(email);
        // BCryptの照合は意図的に遅い。未登録のときに照合を省くと応答が速くなり、登録の有無を推測されるため、必ず1回照合する
        String hash = found.map(User::getPasswordHash).orElse(dummyPasswordHash);
        boolean matches = passwordEncoder.matches(request.password(), hash);
        User user = found.filter(u -> matches)
                .orElseThrow(() -> ApiException.unauthorized("メールアドレスまたはパスワードが正しくありません"));
        // ログイン前から存在するセッションIDを使い回さない(セッション固定攻撃対策)
        if (httpRequest.getSession(false) != null) {
            httpRequest.changeSessionId();
        }
        currentUser.signIn(httpRequest, user);
        return UserResponse.from(user);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest httpRequest) {
        HttpSession session = httpRequest.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }

    @GetMapping("/me")
    public UserResponse me(HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        return userRepository.findById(userId)
                .map(UserResponse::from)
                .orElseThrow(() -> ApiException.unauthorized("ログインしていません"));
    }
}
