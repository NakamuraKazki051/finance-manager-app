package com.financemanager.api.book;

import com.financemanager.api.auth.CurrentUser;
import com.financemanager.api.book.BookImportDtos.ImportCategoryRequest;
import com.financemanager.api.book.BookImportDtos.ImportRequest;
import com.financemanager.api.book.BookImportDtos.ImportTransactionRequest;
import com.financemanager.api.category.Category;
import com.financemanager.api.category.CategoryRepository;
import com.financemanager.api.common.ApiException;
import com.financemanager.api.transaction.Transaction;
import com.financemanager.api.transaction.TransactionRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
public class BookImportController {

    private final BookRepository bookRepository;
    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;
    private final CurrentUser currentUser;

    public BookImportController(BookRepository bookRepository, CategoryRepository categoryRepository,
                                TransactionRepository transactionRepository, CurrentUser currentUser) {
        this.bookRepository = bookRepository;
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        this.currentUser = currentUser;
    }

    /** 家計簿のカテゴリ・取引をバックアップの内容で置き換える。途中で不正なデータがあれば何も変更しない */
    @PutMapping("/api/books/{bookId}/import")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void importBook(@PathVariable String bookId, @Valid @RequestBody ImportRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        if (!bookRepository.existsByIdAndUserId(bookId, userId)) {
            throw ApiException.notFound("家計簿が見つかりません: " + bookId);
        }

        transactionRepository.deleteByBookId(bookId);
        categoryRepository.deleteByBookId(bookId);

        Map<String, String> categoryIdMap = new HashMap<>();
        int order = 0;
        for (ImportCategoryRequest categoryRequest : request.categories()) {
            Category category = categoryRepository.save(
                    new Category(bookId, categoryRequest.name().trim(), categoryRequest.type(), order++));
            if (categoryRequest.id() != null) {
                categoryIdMap.put(categoryRequest.id(), category.getId());
            }
        }

        if (request.transactions() == null) {
            return;
        }
        for (ImportTransactionRequest transactionRequest : request.transactions()) {
            String newCategoryId = categoryIdMap.get(transactionRequest.categoryId());
            if (newCategoryId == null) {
                throw ApiException.badRequest("取引が参照するカテゴリが見つかりません: " + transactionRequest.categoryId());
            }
            Transaction transaction = new Transaction(bookId, newCategoryId, transactionRequest.amount(), transactionRequest.date());
            transaction.setMemo(transactionRequest.memo());
            transaction.setTags(transactionRequest.tags());
            transactionRepository.save(transaction);
        }
    }
}
