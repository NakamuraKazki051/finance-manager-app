package com.financemanager.api.category;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CategoryRepository extends JpaRepository<Category, String> {
    List<Category> findByBookIdOrderByDisplayOrderAsc(String bookId);

    long countByBookId(String bookId);

    void deleteByBookId(String bookId);
}
