package com.financemanager.api.book;

import com.financemanager.api.category.CategoryType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;

public class BookImportDtos {

    private BookImportDtos() {
    }

    public record ImportCategoryRequest(
            String id,
            @NotBlank @Size(max = 30, message = "カテゴリ名は30文字以内で入力してください") String name,
            @NotNull CategoryType type
    ) {
    }

    public record ImportTransactionRequest(
            @NotBlank String categoryId,
            @NotNull @Min(value = 1, message = "金額は1円以上で入力してください")
            @Max(value = 99_999_999, message = "金額は99,999,999円以下で入力してください") Long amount,
            @NotNull LocalDate date,
            @Size(max = 100, message = "メモは100文字以内で入力してください") String memo,
            List<@Size(max = 30, message = "タグは1つ30文字以内で入力してください") String> tags
    ) {
    }

    // 要素に @Valid を付けないと、カテゴリ・取引それぞれの @NotBlank / @Size が検証されない
    public record ImportRequest(
            @NotEmpty List<@Valid ImportCategoryRequest> categories,
            List<@Valid ImportTransactionRequest> transactions
    ) {
    }
}
