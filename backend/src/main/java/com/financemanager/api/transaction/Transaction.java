package com.financemanager.api.transaction;

import jakarta.persistence.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 1件のお金の出入り。金額は円の整数(小数の誤差を避けるため)で、符号は持たない。
 * 収入か支出かは所属するカテゴリの種別で決まる。
 */
@Entity
@Table(name = "transactions", indexes = @Index(name = "idx_transactions_book_date", columnList = "bookId, transaction_date"))
public class Transaction {

    @Id
    private String id;

    private String bookId;
    private String categoryId;

    private long amount;

    // DATE は多くのDBで予約語なので、列名は transaction_date にする
    @Column(name = "transaction_date")
    private LocalDate date;

    @Column(length = 100)
    private String memo;

    private Instant createdAt;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "transaction_tags", joinColumns = @JoinColumn(name = "transaction_id"))
    @Column(name = "tag")
    @OrderColumn(name = "position")
    private List<String> tags = new ArrayList<>();

    protected Transaction() {
    }

    public Transaction(String bookId, String categoryId, long amount, LocalDate date) {
        this.bookId = bookId;
        this.categoryId = categoryId;
        this.amount = amount;
        this.date = date;
        this.createdAt = Instant.now();
    }

    @PrePersist
    void ensureId() {
        if (id == null) {
            id = UUID.randomUUID().toString();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    // getters / setters
    public String getId() { return id; }
    public String getBookId() { return bookId; }
    public String getCategoryId() { return categoryId; }
    public void setCategoryId(String categoryId) { this.categoryId = categoryId; }
    public long getAmount() { return amount; }
    public void setAmount(long amount) { this.amount = amount; }
    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }
    public String getMemo() { return memo; }
    public void setMemo(String memo) { this.memo = memo; }
    public Instant getCreatedAt() { return createdAt; }
    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) {
        this.tags.clear();
        if (tags != null) {
            this.tags.addAll(tags);
        }
    }
}
