package com.financemanager.api.transaction;

import com.financemanager.api.auth.CurrentUser;
import com.financemanager.api.book.BookRepository;
import com.financemanager.api.category.Category;
import com.financemanager.api.category.CategoryRepository;
import com.financemanager.api.category.CategoryType;
import com.financemanager.api.common.ApiException;
import com.financemanager.api.transaction.TransactionDtos.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
public class TransactionController {

    private final TransactionRepository transactionRepository;
    private final BookRepository bookRepository;
    private final CategoryRepository categoryRepository;
    private final CurrentUser currentUser;

    public TransactionController(TransactionRepository transactionRepository, BookRepository bookRepository,
                                 CategoryRepository categoryRepository, CurrentUser currentUser) {
        this.transactionRepository = transactionRepository;
        this.bookRepository = bookRepository;
        this.categoryRepository = categoryRepository;
        this.currentUser = currentUser;
    }

    /**
     * 取引の一覧。month(YYYY-MM)を指定するとその月だけを返す。
     * 並び順は sort=date(日付の新しい順、既定)または sort=amount(金額の大きい順)。
     */
    @GetMapping("/api/books/{bookId}/transactions")
    public List<TransactionResponse> list(
            @PathVariable String bookId,
            @RequestParam(required = false) String month,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Long minAmount,
            @RequestParam(required = false) Long maxAmount,
            @RequestParam(defaultValue = "date") String sort,
            HttpServletRequest httpRequest
    ) {
        String userId = currentUser.require(httpRequest);
        requireBookOwnership(bookId, userId);
        List<Transaction> transactions;
        if (month != null && !month.isBlank()) {
            YearMonth ym = Months.parse(month);
            transactions = transactionRepository.findByBookIdAndDateBetween(bookId, ym.atDay(1), ym.atEndOfMonth());
        } else {
            transactions = transactionRepository.findByBookId(bookId);
        }

        if (tag != null && !tag.isBlank()) {
            transactions = transactions.stream().filter(t -> t.getTags().contains(tag)).toList();
        }
        if (q != null && !q.isBlank()) {
            String needle = q.toLowerCase();
            transactions = transactions.stream()
                    .filter(t -> t.getMemo() != null && t.getMemo().toLowerCase().contains(needle))
                    .toList();
        }
        if (minAmount != null) {
            transactions = transactions.stream().filter(t -> t.getAmount() >= minAmount).toList();
        }
        if (maxAmount != null) {
            transactions = transactions.stream().filter(t -> t.getAmount() <= maxAmount).toList();
        }

        // 同じ日付・金額どうしは登録の新しい順にして、表示順を安定させる
        Comparator<Transaction> newestFirst = Comparator.comparing(Transaction::getDate)
                .thenComparing(Transaction::getCreatedAt).reversed();
        Comparator<Transaction> comparator = switch (sort) {
            case "date" -> newestFirst;
            case "amount" -> Comparator.comparingLong(Transaction::getAmount).reversed().thenComparing(newestFirst);
            default -> throw ApiException.badRequest("並び順は date か amount で指定してください: " + sort);
        };
        return transactions.stream().sorted(comparator).map(TransactionResponse::from).toList();
    }

    /** 月の収入合計・支出合計・残高と、カテゴリごとの合計。取引の無いカテゴリも 0 円で含める */
    @GetMapping("/api/books/{bookId}/summary")
    public SummaryResponse summary(@PathVariable String bookId, @RequestParam String month, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        requireBookOwnership(bookId, userId);
        YearMonth ym = Months.parse(month);

        Map<String, Object[]> rowsByCategory = new HashMap<>();
        for (Object[] row : transactionRepository.sumByCategory(bookId, ym.atDay(1), ym.atEndOfMonth())) {
            rowsByCategory.put((String) row[0], row);
        }

        long income = 0;
        long expense = 0;
        long count = 0;
        List<CategoryTotal> totals = new ArrayList<>();
        for (Category category : categoryRepository.findByBookIdOrderByDisplayOrderAsc(bookId)) {
            Object[] row = rowsByCategory.get(category.getId());
            long total = row != null ? ((Number) row[1]).longValue() : 0;
            long n = row != null ? ((Number) row[2]).longValue() : 0;
            totals.add(new CategoryTotal(category.getId(), total, n));
            if (category.getType() == CategoryType.INCOME) {
                income += total;
            } else {
                expense += total;
            }
            count += n;
        }
        return new SummaryResponse(ym.toString(), income, expense, income - expense, count, totals);
    }

    @GetMapping("/api/transactions/{id}")
    public TransactionResponse get(@PathVariable String id, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Transaction transaction = findOrThrow(id);
        requireBookOwnership(transaction.getBookId(), userId);
        return TransactionResponse.from(transaction);
    }

    @PostMapping("/api/books/{bookId}/transactions")
    @ResponseStatus(HttpStatus.CREATED)
    public TransactionResponse create(@PathVariable String bookId, @Valid @RequestBody TransactionRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        requireBookOwnership(bookId, userId);
        Category category = requireCategoryInBook(request.categoryId(), bookId);
        Transaction transaction = new Transaction(bookId, category.getId(), request.amount(), request.date());
        applyRequest(transaction, request);
        return TransactionResponse.from(transactionRepository.save(transaction));
    }

    @PutMapping("/api/transactions/{id}")
    @Transactional
    public TransactionResponse update(@PathVariable String id, @Valid @RequestBody TransactionRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Transaction transaction = findOrThrow(id);
        requireBookOwnership(transaction.getBookId(), userId);
        Category category = requireCategoryInBook(request.categoryId(), transaction.getBookId());
        transaction.setCategoryId(category.getId());
        transaction.setAmount(request.amount());
        transaction.setDate(request.date());
        applyRequest(transaction, request);
        return TransactionResponse.from(transactionRepository.save(transaction));
    }

    private void applyRequest(Transaction transaction, TransactionRequest request) {
        String memo = request.memo() != null ? request.memo().trim() : null;
        transaction.setMemo(memo == null || memo.isEmpty() ? null : memo);
        transaction.setTags(request.tags());
    }

    /** ドラッグ&ドロップで別のカテゴリへ付け替える */
    @PatchMapping("/api/transactions/{id}/move")
    @Transactional
    public TransactionResponse move(@PathVariable String id, @Valid @RequestBody MoveRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Transaction transaction = findOrThrow(id);
        requireBookOwnership(transaction.getBookId(), userId);
        Category category = requireCategoryInBook(request.categoryId(), transaction.getBookId());
        transaction.setCategoryId(category.getId());
        return TransactionResponse.from(transactionRepository.save(transaction));
    }

    @DeleteMapping("/api/transactions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String id, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        Transaction transaction = findOrThrow(id);
        requireBookOwnership(transaction.getBookId(), userId);
        transactionRepository.delete(transaction);
    }

    @PostMapping("/api/books/{bookId}/transactions/bulk-delete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void bulkDelete(@PathVariable String bookId, @Valid @RequestBody BulkDeleteRequest request, HttpServletRequest httpRequest) {
        String userId = currentUser.require(httpRequest);
        requireBookOwnership(bookId, userId);
        Set<String> ids = new LinkedHashSet<>(request.transactionIds());
        List<Transaction> targets = transactionRepository.findAllById(ids);
        // 1件でも見つからない・別の家計簿の取引が混ざっていれば何も削除せずに失敗させる
        if (targets.size() != ids.size() || targets.stream().anyMatch(t -> !t.getBookId().equals(bookId))) {
            throw ApiException.notFound("削除対象に存在しない取引が含まれています");
        }
        transactionRepository.deleteAll(targets);
    }

    private void requireBookOwnership(String bookId, String userId) {
        if (!bookRepository.existsByIdAndUserId(bookId, userId)) {
            throw ApiException.notFound("家計簿が見つかりません: " + bookId);
        }
    }

    private Category requireCategoryInBook(String categoryId, String bookId) {
        Category category = categoryRepository.findById(categoryId)
                .orElseThrow(() -> ApiException.notFound("カテゴリが見つかりません: " + categoryId));
        if (!category.getBookId().equals(bookId)) {
            throw ApiException.badRequest("指定したカテゴリはこの家計簿に属していません");
        }
        return category;
    }

    private Transaction findOrThrow(String id) {
        return transactionRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("取引が見つかりません: " + id));
    }
}
