package com.financemanager.api.category;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public class CategoryDtos {

    private CategoryDtos() {
    }

    public record CategoryRequest(
            @NotBlank @Size(max = 30, message = "カテゴリ名は30文字以内で入力してください") String name,
            @NotNull(message = "収入か支出かを指定してください") CategoryType type
    ) {
    }

    public record CategoryUpdateRequest(@Size(max = 30, message = "カテゴリ名は30文字以内で入力してください") String name, CategoryType type) {
    }

    public record CategoryMoveRequest(int displayOrder) {
    }

    public record CategoryResponse(String id, String bookId, String name, CategoryType type, int displayOrder) {
        public static CategoryResponse from(Category category) {
            return new CategoryResponse(category.getId(), category.getBookId(), category.getName(),
                    category.getType(), category.getDisplayOrder());
        }
    }
}
