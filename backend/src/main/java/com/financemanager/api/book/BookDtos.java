package com.financemanager.api.book;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class BookDtos {

    private BookDtos() {
    }

    public record BookRequest(@NotBlank @Size(max = 30, message = "家計簿の名前は30文字以内で入力してください") String name) {
    }

    public record BookResponse(String id, String name) {
        public static BookResponse from(Book book) {
            return new BookResponse(book.getId(), book.getName());
        }
    }
}
