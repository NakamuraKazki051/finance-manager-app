package com.financemanager.api.book;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.util.UUID;

/** 家計簿。カテゴリと取引をまとめる単位で、ユーザーは用途ごとに複数持てる(生活費・副業など) */
@Entity
@Table(name = "books")
public class Book {

    @Id
    private String id;

    private String userId;

    private String name;

    protected Book() {
    }

    public Book(String userId, String name) {
        this.userId = userId;
        this.name = name;
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

    public String getUserId() {
        return userId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
