package com.financemanager.api.book;

import com.financemanager.api.auth.CurrentUser;
import com.financemanager.api.book.BookDtos.BookRequest;
import com.financemanager.api.book.BookDtos.BookResponse;
import com.financemanager.api.category.CategoryRepository;
import com.financemanager.api.category.DefaultCategories;
import com.financemanager.api.common.ApiException;
import com.financemanager.api.transaction.TransactionRepository;
import com.financemanager.api.user.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/books")
public class BookController {

    static final String DEFAULT_BOOK_NAME = "家計簿";

    private final BookRepository bookRepository;
    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;
    private final UserRepository userRepository;
    private final CurrentUser currentUser;

    public BookController(BookRepository bookRepository, CategoryRepository categoryRepository,
                          TransactionRepository transactionRepository, UserRepository userRepository, CurrentUser currentUser) {
        this.bookRepository = bookRepository;
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        this.userRepository = userRepository;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<BookResponse> list(HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        return bookRepository.findByUserId(userId).stream().map(BookResponse::from).toList();
    }

    /** 新しい家計簿を作る。カテゴリが空だと取引を登録できないので、初期カテゴリも一緒に作る */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public BookResponse create(@Valid @RequestBody BookRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Book book = bookRepository.save(new Book(userId, request.name().trim()));
        DefaultCategories.createFor(book.getId(), categoryRepository);
        return BookResponse.from(book);
    }

    /**
     * 家計簿が1つも無いユーザーに、初期の家計簿と初期カテゴリを作る。既に家計簿があれば何もせず一覧を返す。
     * 初回ログイン時に複数タブや二重送信で同時に呼ばれても、ユーザー行のロックで直列化されるので1つしか作られない。
     */
    @PostMapping("/ensure-default")
    @Transactional
    public List<BookResponse> ensureDefault(HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        userRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> ApiException.unauthorized("ログインしていません"));
        List<Book> books = bookRepository.findByUserId(userId);
        if (books.isEmpty()) {
            Book book = bookRepository.save(new Book(userId, DEFAULT_BOOK_NAME));
            DefaultCategories.createFor(book.getId(), categoryRepository);
            books = List.of(book);
        }
        return books.stream().map(BookResponse::from).toList();
    }

    @PutMapping("/{id}")
    public BookResponse rename(@PathVariable String id, @Valid @RequestBody BookRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Book book = bookRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("家計簿が見つかりません: " + id));
        book.setName(request.name().trim());
        return BookResponse.from(bookRepository.save(book));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String id, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        if (!bookRepository.existsByIdAndUserId(id, userId)) {
            throw ApiException.notFound("家計簿が見つかりません: " + id);
        }
        if (bookRepository.countByUserId(userId) <= 1) {
            throw ApiException.badRequest("最後の1冊の家計簿は削除できません");
        }
        // カテゴリ・取引は家計簿への外部キーを持たないため、明示的に消さないとDBに残り続ける
        transactionRepository.deleteByBookId(id);
        categoryRepository.deleteByBookId(id);
        bookRepository.deleteById(id);
    }
}
