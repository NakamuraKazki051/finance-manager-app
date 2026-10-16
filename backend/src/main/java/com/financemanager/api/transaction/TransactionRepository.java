package com.financemanager.api.transaction;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface TransactionRepository extends JpaRepository<Transaction, String> {
    List<Transaction> findByBookId(String bookId);

    List<Transaction> findByBookIdAndDateBetween(String bookId, LocalDate from, LocalDate to);

    long countByCategoryId(String categoryId);

    void deleteByBookId(String bookId);

    void deleteByCategoryId(String categoryId);

    /** カテゴリごとの合計額と件数。行は [categoryId, 合計(Long), 件数(Long)] */
    @Query("select t.categoryId, sum(t.amount), count(t) from Transaction t"
            + " where t.bookId = :bookId and t.date between :from and :to group by t.categoryId")
    List<Object[]> sumByCategory(@Param("bookId") String bookId, @Param("from") LocalDate from, @Param("to") LocalDate to);
}
