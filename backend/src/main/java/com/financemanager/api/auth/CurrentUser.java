package com.financemanager.api.auth;

import com.financemanager.api.common.ApiException;
import com.financemanager.api.user.User;
import com.financemanager.api.user.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;

import java.util.Objects;

@Component
public class CurrentUser {

    public static final String SESSION_KEY = "userId";
    // ログインした時点のパスワードハッシュ。パスワードが変わると一致しなくなり、他の端末のセッションが切れる
    static final String CREDENTIAL_KEY = "credential";

    private final UserRepository userRepository;

    public CurrentUser(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public String require(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        String userId = session != null ? (String) session.getAttribute(SESSION_KEY) : null;
        if (userId == null) {
            throw ApiException.unauthorized("ログインが必要です");
        }
        String credential = (String) session.getAttribute(CREDENTIAL_KEY);
        boolean stillValid = userRepository.findById(userId)
                .map(user -> Objects.equals(user.getPasswordHash(), credential))
                .orElse(false);
        if (!stillValid) {
            session.invalidate();
            throw ApiException.unauthorized("ログインの有効期限が切れました(パスワードが変更された可能性があります)。もう一度ログインしてください");
        }
        return userId;
    }

    /** ログイン状態をセッションに記録する。パスワードを変更した本人のセッションを維持するときにも使う */
    public void signIn(HttpServletRequest request, User user) {
        HttpSession session = request.getSession(true);
        session.setAttribute(SESSION_KEY, user.getId());
        session.setAttribute(CREDENTIAL_KEY, user.getPasswordHash());
    }
}
