package com.financemanager.api.book;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BookRepository extends JpaRepository<Book, String> {
    List<Book> findByUserId(String userId);
    Optional<Book> findByIdAndUserId(String id, String userId);
    boolean existsByIdAndUserId(String id, String userId);
    long countByUserId(String userId);
}
