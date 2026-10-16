package com.financemanager.api.category;

import java.util.List;

/** 家計簿を作ったときに用意する初期カテゴリ。収入を左、支出を右に並べる */
public final class DefaultCategories {

    private record Entry(String name, CategoryType type) {
    }

    private static final List<Entry> ENTRIES = List.of(
            new Entry("給与", CategoryType.INCOME),
            new Entry("食費", CategoryType.EXPENSE),
            new Entry("日用品", CategoryType.EXPENSE),
            new Entry("交通費", CategoryType.EXPENSE),
            new Entry("住居・光熱費", CategoryType.EXPENSE),
            new Entry("その他", CategoryType.EXPENSE)
    );

    private DefaultCategories() {
    }

    public static void createFor(String bookId, CategoryRepository categoryRepository) {
        for (int i = 0; i < ENTRIES.size(); i++) {
            Entry entry = ENTRIES.get(i);
            categoryRepository.save(new Category(bookId, entry.name(), entry.type(), i));
        }
    }
}
