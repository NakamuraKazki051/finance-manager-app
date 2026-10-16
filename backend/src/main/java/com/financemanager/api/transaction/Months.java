package com.financemanager.api.transaction;

import com.financemanager.api.common.ApiException;

import java.time.YearMonth;
import java.time.format.DateTimeParseException;

/** クエリパラメータの month(YYYY-MM)を読む */
final class Months {

    private Months() {
    }

    static YearMonth parse(String month) {
        try {
            return YearMonth.parse(month);
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("月は YYYY-MM の形式で指定してください: " + month);
        }
    }
}
