package com.financemanager.api.category;

import com.financemanager.api.auth.CurrentUser;
import com.financemanager.api.book.BookRepository;
import com.financemanager.api.category.CategoryDtos.CategoryMoveRequest;
import com.financemanager.api.category.CategoryDtos.CategoryRequest;
import com.financemanager.api.category.CategoryDtos.CategoryResponse;
import com.financemanager.api.category.CategoryDtos.CategoryUpdateRequest;
import com.financemanager.api.common.ApiException;
import com.financemanager.api.transaction.TransactionRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;

@RestController
public class CategoryController {

    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;
    private final BookRepository bookRepository;
    private final CurrentUser currentUser;

    public CategoryController(CategoryRepository categoryRepository, TransactionRepository transactionRepository,
                              BookRepository bookRepository, CurrentUser currentUser) {
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        this.bookRepository = bookRepository;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/books/{bookId}/categories")
    public List<CategoryResponse> list(@PathVariable String bookId, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        requireBookOwnership(bookId, userId);
        return categoryRepository.findByBookIdOrderByDisplayOrderAsc(bookId).stream()
                .map(CategoryResponse::from).toList();
    }

    @PostMapping("/api/books/{bookId}/categories")
    @ResponseStatus(HttpStatus.CREATED)
    public CategoryResponse create(@PathVariable String bookId, @Valid @RequestBody CategoryRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        requireBookOwnership(bookId, userId);
        int nextOrder = (int) categoryRepository.countByBookId(bookId);
        Category category = new Category(bookId, request.name().trim(), request.type(), nextOrder);
        return CategoryResponse.from(categoryRepository.save(category));
    }

    @PutMapping("/api/categories/{id}")
    public CategoryResponse update(@PathVariable String id, @Valid @RequestBody CategoryUpdateRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Category category = findOrThrow(id);
        requireBookOwnership(category.getBookId(), userId);
        if (request.name() != null && !request.name().isBlank()) {
            category.setName(request.name().trim());
        }
        if (request.type() != null) {
            category.setType(request.type());
        }
        return CategoryResponse.from(categoryRepository.save(category));
    }

    @PatchMapping("/api/categories/{id}/move")
    @Transactional
    public CategoryResponse move(@PathVariable String id, @Valid @RequestBody CategoryMoveRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Category category = findOrThrow(id);
        requireBookOwnership(category.getBookId(), userId);
        List<Category> bookCategories = new ArrayList<>(categoryRepository.findByBookIdOrderByDisplayOrderAsc(category.getBookId()));
        bookCategories.removeIf(c -> c.getId().equals(id));
        int index = Math.max(0, Math.min(request.displayOrder(), bookCategories.size()));
        bookCategories.add(index, category);
        for (int i = 0; i < bookCategories.size(); i++) {
            bookCategories.get(i).setDisplayOrder(i);
        }
        categoryRepository.saveAll(bookCategories);
        return CategoryResponse.from(category);
    }

    /** カテゴリを削除する。そのカテゴリの取引もすべて削除される(画面で件数を示して確認してから呼ぶ) */
    @DeleteMapping("/api/categories/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String id, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Category category = findOrThrow(id);
        requireBookOwnership(category.getBookId(), userId);
        if (categoryRepository.countByBookId(category.getBookId()) <= 1) {
            throw ApiException.badRequest("最後の1カテゴリは削除できません");
        }
        String bookId = category.getBookId();
        transactionRepository.deleteByCategoryId(id);
        categoryRepository.deleteById(id);
        List<Category> remaining = categoryRepository.findByBookIdOrderByDisplayOrderAsc(bookId);
        for (int i = 0; i < remaining.size(); i++) {
            remaining.get(i).setDisplayOrder(i);
        }
        categoryRepository.saveAll(remaining);
    }

    private void requireBookOwnership(String bookId, String userId) {
        if (!bookRepository.existsByIdAndUserId(bookId, userId)) {
            throw ApiException.notFound("家計簿が見つかりません: " + bookId);
        }
    }

    private Category findOrThrow(String id) {
        return categoryRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("カテゴリが見つかりません: " + id));
    }
}
