package com.financemanager.api.transaction;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public class TransactionDtos {

    static final long MAX_AMOUNT = 99_999_999L;

    private TransactionDtos() {
    }

    public record TransactionRequest(
            @NotNull(message = "金額を入力してください")
            @Min(value = 1, message = "金額は1円以上で入力してください")
            @Max(value = MAX_AMOUNT, message = "金額は99,999,999円以下で入力してください") Long amount,
            @NotNull(message = "日付を入力してください") LocalDate date,
            @NotBlank String categoryId,
            @Size(max = 100, message = "メモは100文字以内で入力してください") String memo,
            // リスト自体ではなく中の要素を検証するため、型引数側に付ける
            List<@Size(max = 30, message = "タグは1つ30文字以内で入力してください") String> tags
    ) {
    }

    public record MoveRequest(@NotBlank String categoryId) {
    }

    public record BulkDeleteRequest(@NotEmpty List<String> transactionIds) {
    }

    public record TransactionResponse(
            String id,
            String bookId,
            String categoryId,
            long amount,
            LocalDate date,
            String memo,
            List<String> tags,
            Instant createdAt
    ) {
        public static TransactionResponse from(Transaction transaction) {
            return new TransactionResponse(
                    transaction.getId(),
                    transaction.getBookId(),
                    transaction.getCategoryId(),
                    transaction.getAmount(),
                    transaction.getDate(),
                    transaction.getMemo(),
                    transaction.getTags(),
                    transaction.getCreatedAt()
            );
        }
    }

    public record CategoryTotal(String categoryId, long total, long count) {
    }

    /** 月の収支。income・expense は合計額(円)、balance は income - expense */
    public record SummaryResponse(String month, long income, long expense, long balance, long count, List<CategoryTotal> categories) {
    }
}
