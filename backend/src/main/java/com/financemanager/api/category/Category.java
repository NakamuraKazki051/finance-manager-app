package com.financemanager.api.category;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.util.UUID;

/** 収支のカテゴリ(給与・食費など)。画面ではカンバンの1列になる */
@Entity
@Table(name = "categories")
public class Category {

    @Id
    private String id;

    private String bookId;
    private String name;

    @Enumerated(EnumType.STRING)
    private CategoryType type;

    private int displayOrder;

    protected Category() {
    }

    public Category(String bookId, String name, CategoryType type, int displayOrder) {
        this.bookId = bookId;
        this.name = name;
        this.type = type;
        this.displayOrder = displayOrder;
    }

    @PrePersist
    void ensureId() {
        if (id == null) {
            id = UUID.randomUUID().toString();
        }
    }

    public String getId() {
        return id;
    }

    public String getBookId() {
        return bookId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public CategoryType getType() {
        return type;
    }

    public void setType(CategoryType type) {
        this.type = type;
    }

    public int getDisplayOrder() {
        return displayOrder;
    }

    public void setDisplayOrder(int displayOrder) {
        this.displayOrder = displayOrder;
    }
}
