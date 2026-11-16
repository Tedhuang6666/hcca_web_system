"""預算 Excel 匯出。"""

from collections import OrderedDict
from io import BytesIO

from api.schemas.finance import BudgetPlanOut, BudgetPlanRowOut


def budget_workbook(plan: BudgetPlanOut) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    workbook.remove(workbook.active)
    for sheet_name, selected in (
        ("預算總表", plan.rows),
        ("本次新增", [row for row in plan.rows if row.is_new]),
    ):
        sheet = workbook.create_sheet(sheet_name)
        sheet.append(["項目", "細項", "數量", "單價", "總額(含稅)", "項目總額", "備註"])
        groups: dict[str, list[BudgetPlanRowOut]] = OrderedDict()
        for row in selected:
            groups.setdefault(row.category, []).append(row)
        for category, entries in groups.items():
            start = sheet.max_row + 1
            balance = sum(row.amount * (1 if row.income else -1) for row in entries)
            for index, row in enumerate(entries):
                sheet.append(
                    [
                        category if index == 0 else None,
                        row.name,
                        f"{row.quantity:g}{row.unit or ''}" if row.quantity else "1式",
                        row.unit_price or "*",
                        row.amount,
                        abs(balance) if index == 0 else None,
                        row.note,
                    ]
                )
                if row.is_new:
                    for cell in sheet[sheet.max_row]:
                        cell.fill = PatternFill("solid", fgColor="FCE5CD")
                sheet.cell(sheet.max_row, 5).fill = PatternFill(
                    "solid", fgColor="D9EAD3" if row.income else "F4CCCC"
                )
            end = sheet.max_row
            if end > start:
                sheet.merge_cells(start_row=start, end_row=end, start_column=1, end_column=1)
                sheet.merge_cells(start_row=start, end_row=end, start_column=6, end_column=6)
            sheet.cell(start, 6).fill = PatternFill(
                "solid", fgColor="D9EAD3" if balance >= 0 else "F4CCCC"
            )
        for sheet_row in sheet:
            for cell in sheet_row:
                if isinstance(cell.value, str):
                    cell.data_type = "s"
                cell.font = Font(name="微軟正黑體", size=11, bold=cell.row == 1)
                cell.alignment = Alignment(vertical="center", wrap_text=True)
        for index, width in enumerate((20, 32, 12, 12, 16, 16, 48), 1):
            sheet.column_dimensions[get_column_letter(index)].width = width
        sheet.freeze_panes = "C2"
        sheet.print_title_rows = "1:1"
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.page_setup.orientation = "landscape"
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
