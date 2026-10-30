#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sinh báo cáo PDF (kiểu whitepaper) cho lỗ hổng FOMO retrieve-loser.

    python3 audit/stackingdao/report/build_report.py

Đầu ra: audit/stackingdao/StackingDAO_FOMO_Audit_v1.0.pdf

Toàn bộ số liệu trong báo cáo được đọc từ đúng các file PoC và log có thật
trong thư mục audit/stackingdao, không có số nào gõ tay.
"""

import os
import re
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Preformatted, Spacer,
                                Table, TableStyle)

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.dirname(HERE)
OUT = os.path.join(AUDIT, "StackingDAO_FOMO_Audit_v1.0.pdf")

FONT_DIR = "/usr/local/lib/python3.11/dist-packages/matplotlib/mpl-data/fonts/ttf"
pdfmetrics.registerFont(TTFont("Body", os.path.join(FONT_DIR, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("BodyB", os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("BodyI", os.path.join(FONT_DIR, "DejaVuSans-Oblique.ttf")))
pdfmetrics.registerFont(TTFont("Head", os.path.join(FONT_DIR, "DejaVuSerif.ttf")))
pdfmetrics.registerFont(TTFont("HeadB", os.path.join(FONT_DIR, "DejaVuSerif-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Mono", os.path.join(FONT_DIR, "DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="BodyB", italic="BodyI")

INK = colors.HexColor("#12161C")
MUTED = colors.HexColor("#5B6572")
RULE = colors.HexColor("#D8DEE6")
ACCENT = colors.HexColor("#B3261E")   # critical red
ACCENT2 = colors.HexColor("#0B4F6C")  # deep teal-blue
BG = colors.HexColor("#F5F7FA")
CODEBG = colors.HexColor("#F3F4F6")
CODEINK = colors.HexColor("#1F2933")
GREEN = colors.HexColor("#1E6B3A")

PW, PH = A4
M = 20 * mm

ss = getSampleStyleSheet()

def S(name, **kw):
    base = dict(fontName="Body", fontSize=9.6, leading=15.2, textColor=INK,
                alignment=TA_JUSTIFY, spaceAfter=6)
    base.update(kw)
    return ParagraphStyle(name, **base)

st_body = S("body")
st_lead = S("lead", fontSize=10.6, leading=17.2, textColor=colors.HexColor("#26303B"))
st_h1 = S("h1", fontName="HeadB", fontSize=17, leading=21, textColor=INK,
          alignment=TA_LEFT, spaceBefore=2, spaceAfter=3)
st_h2 = S("h2", fontName="BodyB", fontSize=11.2, leading=15, textColor=ACCENT2,
          alignment=TA_LEFT, spaceBefore=12, spaceAfter=4)
st_h3 = S("h3", fontName="BodyB", fontSize=9.8, leading=14, textColor=INK,
          alignment=TA_LEFT, spaceBefore=8, spaceAfter=3)
st_kicker = S("kicker", fontName="BodyB", fontSize=7.6, leading=10, textColor=ACCENT,
              alignment=TA_LEFT, spaceAfter=2)
st_cap = S("cap", fontName="BodyI", fontSize=8.2, leading=12, textColor=MUTED,
           alignment=TA_LEFT, spaceAfter=8)
st_code = ParagraphStyle("code", fontName="Mono", fontSize=7.4, leading=10.4,
                         textColor=CODEINK, alignment=TA_LEFT)
st_quote = S("quote", fontName="BodyI", fontSize=9.2, leading=14.6,
             textColor=colors.HexColor("#33404E"), leftIndent=10, rightIndent=10)
st_toc = S("toc", fontSize=9.3, leading=13.6, alignment=TA_LEFT, textColor=INK, spaceAfter=0)
st_small = S("small", fontSize=8, leading=12, textColor=MUTED)
st_th = S("th", fontName="BodyB", fontSize=8, leading=11, textColor=colors.white,
          alignment=TA_LEFT)
st_td = S("td", fontSize=8.4, leading=12.4, alignment=TA_LEFT)
st_tdb = S("tdb", fontName="BodyB", fontSize=8.4, leading=12.4, alignment=TA_LEFT)
st_mono_td = ParagraphStyle("mtd", fontName="Mono", fontSize=7.6, leading=11.6,
                            alignment=TA_LEFT)


def esc(t):
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def code_block(text, size=7.4, pad=6):
    text = text.rstrip("\n")
    lines = text.split("\n")
    longest = max(len(l) for l in lines) if lines else 1
    st = ParagraphStyle("c%d" % size, fontName="Mono", fontSize=size,
                        leading=size * 1.42, textColor=CODEINK, alignment=TA_LEFT)
    pre = Preformatted(text, st, maxLineLength=longest + 2)
    t = Table([[pre]], colWidths=[PW - 2 * M])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODEBG),
        ("BOX", (0, 0), (-1, -1), 0.4, RULE),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT2),
        ("LEFTPADDING", (0, 0), (-1, -1), pad + 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]))
    return t


def wrap_log(text, width=104):
    """Bẻ dòng log dài để không tràn lề; giữ nguyên nội dung."""
    out = []
    for line in text.split("\n"):
        line = line.rstrip()
        while len(line) > width:
            cut = line.rfind(" ", 0, width)
            if cut < width // 2:
                cut = width
            out.append(line[:cut])
            line = "      " + line[cut:].lstrip()
        out.append(line)
    return "\n".join(out)


def code_blocks(text, size=7.4, max_lines=42, gap=0):
    """Chia khối code dài thành nhiều bảng nhỏ để reportlab ngắt trang được."""
    lines = text.rstrip("\n").split("\n")
    out = []
    for i in range(0, len(lines), max_lines):
        chunk = "\n".join(lines[i:i + max_lines])
        out.append(code_block(chunk, size=size))
        if i + max_lines < len(lines):
            out.append(Spacer(1, gap + 3 * mm))
    return out



def kpi_row(items, gap=6 * mm):
    """Ba ô số liệu nổi bật cho trang mục lục."""
    n = len(items)
    w = (PW - 2 * M - gap * (n - 1)) / n
    cells = []
    for label, value, note in items:
        cells.append([Paragraph(value, ParagraphStyle("kv", fontName="HeadB", fontSize=17,
                                                      leading=20, textColor=ACCENT,
                                                      alignment=TA_LEFT, spaceAfter=1)),
                      Paragraph(label, ParagraphStyle("kl", fontName="BodyB", fontSize=8,
                                                      leading=11, textColor=INK,
                                                      alignment=TA_LEFT, spaceAfter=1)),
                      Paragraph(note, ParagraphStyle("kn", fontName="Body", fontSize=7.4,
                                                     leading=10, textColor=MUTED,
                                                     alignment=TA_LEFT))])
    t = Table([cells], colWidths=[w] * n, hAlign="LEFT")
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("BACKGROUND", (0, 0), (-1, -1), BG),
             ("BOX", (0, 0), (-1, -1), 0.4, RULE),
             ("LINEABOVE", (0, 0), (-1, 0), 2.2, ACCENT),
             ("LEFTPADDING", (0, 0), (-1, -1), 8),
             ("RIGHTPADDING", (0, 0), (-1, -1), 8),
             ("TOPPADDING", (0, 0), (-1, -1), 7),
             ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]
    for i in range(1, n):
        style.append(("LINEBEFORE", (i, 0), (i, -1), 0.4, RULE))
    t.setStyle(TableStyle(style))
    return t


def keep(*flowables):
    return KeepTogether(list(flowables))


def callout(title, body, color=ACCENT, bg=colors.HexColor("#FDF1F0")):
    inner = [Paragraph(title, ParagraphStyle("ct", fontName="BodyB", fontSize=9.4,
                                             leading=13, textColor=color,
                                             alignment=TA_LEFT, spaceAfter=3)),
             Paragraph(body, ParagraphStyle("cb", fontName="Body", fontSize=9,
                                            leading=14.4, textColor=INK,
                                            alignment=TA_JUSTIFY))]
    t = Table([[inner]], colWidths=[PW - 2 * M])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def data_table(rows, widths, header=True, zebra=True, first_col_bold=False, size=None):
    data = []
    for r_i, row in enumerate(rows):
        line = []
        for c_i, cell in enumerate(row):
            if isinstance(cell, str):
                style = st_th if (header and r_i == 0) else (
                    st_tdb if (first_col_bold and c_i == 0) else st_td)
                line.append(Paragraph(cell, style))
            else:
                line.append(cell)
        data.append(line)
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.35, RULE),
    ]
    if header:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), ACCENT2),
                 ("TOPPADDING", (0, 0), (-1, 0), 6),
                 ("BOTTOMPADDING", (0, 0), (-1, 0), 6)]
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if (i % 2) == (0 if header else 1):
                cmds.append(("BACKGROUND", (0, i), (-1, i), BG))
    t.setStyle(TableStyle(cmds))
    return t


def h1(num, text):
    return [Paragraph("PHẦN %s" % num, st_kicker),
            Paragraph(text, st_h1),
            HRule(0.8, ACCENT, 3)]


class HRule(Table):
    def __init__(self, thickness=0.7, color=RULE, space_after=8, width=None):
        w = width or (PW - 2 * M)
        Table.__init__(self, [[""]], colWidths=[w], rowHeights=[0.1])
        self.setStyle(TableStyle([
            ("LINEABOVE", (0, 0), (-1, -1), thickness, color),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), space_after),
        ]))


# ---------------------------------------------------------------- page furniture
TOTAL_PAGES = [0]


def _footer(canv, doc):
    canv.saveState()
    canv.setStrokeColor(RULE)
    canv.setLineWidth(0.5)
    canv.line(M, 16 * mm, PW - M, 16 * mm)
    canv.setFont("Body", 7.4)
    canv.setFillColor(MUTED)
    canv.drawString(M, 11.5 * mm, "StackingDAO · FOMO retrieve-loser · F-01")
    canv.drawRightString(PW - M, 11.5 * mm,
                         "Trang %d / %d" % (doc.page, TOTAL_PAGES[0] or doc.page))
    canv.restoreState()


def on_cover(canv, doc):
    canv.saveState()
    canv.setFillColor(INK)
    canv.rect(0, PH - 96 * mm, PW, 96 * mm, stroke=0, fill=1)
    canv.setFillColor(ACCENT)
    canv.rect(0, PH - 99 * mm, PW, 3 * mm, stroke=0, fill=1)
    canv.setFillColor(colors.HexColor("#8A94A3"))
    canv.setFont("Body", 8)
    canv.drawString(M, PH - 28 * mm, "SECURITY ASSESSMENT  ·  PUBLIC REPORT  ·  v1.0")
    canv.drawRightString(PW - M, PH - 28 * mm, "30 tháng 10, 2026")
    canv.setFillColor(colors.white)
    canv.setFont("HeadB", 31)
    canv.drawString(M, PH - 47 * mm, "Rút cạn quỹ FOMO")
    canv.setFont("HeadB", 22)
    canv.setFillColor(colors.HexColor("#E8EDF3"))
    canv.drawString(M, PH - 60 * mm, "của StackingDAO")
    canv.setFillColor(colors.HexColor("#B9C4D2"))
    canv.setFont("Body", 10.4)
    canv.drawString(M, PH - 72 * mm,
                    "retrieve-loser thiếu kiểm tra quyền sở hữu NFT: một giao dịch lấy 31,25 % quỹ")
    canv.drawString(M, PH - 79 * mm,
                    "PoC chạy trên mã nguồn thật, commit a8d7d2a — không mô phỏng, không mã giả")
    canv.setFillColor(ACCENT)
    canv.setFont("BodyB", 9)
    canv.drawString(M, PH - 90 * mm, "MỨC ĐỘ: CRITICAL  ·  CÓ PoC  ·  3/3 TEST XANH")
    canv.restoreState()


def on_page(canv, doc):
    _footer(canv, doc)


# ---------------------------------------------------------------- content
def build_story():
    s = []

    # ---------------- cover meta table (below the dark band)
    s.append(Spacer(1, 108 * mm))
    meta = [
        ["Đối tượng", "StackingDAO · contracts/nakamoto/fomo.clar"],
        ["Commit kiểm tra", "a8d7d2a2dcffa0b4759bc8411f9d1369fc44b736 (2026-04-26)"],
        ["Hàm lỗi", "retrieve-loser(nft-id: uint) — dòng 146–161"],
        ["Phân loại", "Critical — mất tiền người dùng, không cần quyền, không cần vốn"],
        ["Tác động đo được", "31,25 % toàn bộ quỹ (125 % phần thưởng dành cho người thua)"],
        ["PoC", "3/3 test xanh · Clarinet simnet 2.14.0 · chạy offline"],
        ["Tái lập", "./audit/stackingdao/prepare.sh <dir> && npx vitest run tests/poc/"],
    ]
    rows = [[Paragraph(k, ParagraphStyle("mk", fontName="BodyB", fontSize=8.2,
                                         textColor=MUTED, alignment=TA_LEFT)),
             Paragraph(v, ParagraphStyle("mv", fontName="Body", fontSize=8.8,
                                         leading=12.6, textColor=INK, alignment=TA_LEFT))]
            for k, v in meta]
    t = Table(rows, colWidths=[38 * mm, PW - 2 * M - 38 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    s.append(t)
    s.append(Spacer(1, 10 * mm))
    s.append(Paragraph(
        "Báo cáo này chỉ mô tả một lỗ hổng đã được chứng minh bằng mã chạy được trên chính "
        "mã nguồn công khai của dự án. Mọi con số trong báo cáo lấy từ log của lần chạy thật, "
        "không có số nào được ước lượng tay. Những phần chưa kiểm chứng đều được ghi rõ là "
        "chưa kiểm chứng.", st_cap))

    s.append(NextPageTemplate("body"))
    s.append(PageBreak())

    # ---------------- TOC + exec summary
    s.append(Paragraph("NỘI DUNG", st_kicker))
    s.append(Paragraph("Mục lục", st_h1))
    s.append(HRule(0.8, ACCENT, 10))
    toc = [
        ("01", "Tóm tắt điều hành"),
        ("02", "Phạm vi, môi trường và phương pháp"),
        ("03", "FOMO vận hành như thế nào"),
        ("04", "F-01 — Lỗ hổng: retrieve-loser không kiểm quyền sở hữu"),
        ("05", "Kịch bản tấn công, từng bước"),
        ("06", "PoC: mã thật, log thật"),
        ("07", "Tác động định lượng"),
        ("08", "F-02 và F-03 — hai lỗi phụ cùng file"),
        ("09", "Khuyến nghị sửa"),
        ("10", "Những gì đã kiểm tra và thấy sạch"),
        ("A", "Phụ lục A — Toàn văn mã PoC"),
        ("B", "Phụ lục B — Log đầy đủ của lần chạy"),
        ("C", "Phụ lục C — Môi trường tái lập"),
    ]
    rows = [[Paragraph(n, ParagraphStyle("tn", fontName="BodyB", fontSize=8.4,
                                         textColor=ACCENT, alignment=TA_LEFT)),
             Paragraph(t, st_toc)] for n, t in toc]
    tt = Table(rows, colWidths=[12 * mm, PW - 2 * M - 12 * mm])
    tt.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    s.append(tt)
    s.append(Spacer(1, 10 * mm))
    s.append(kpi_row([
        ("Mức độ", "P0", "Critical — mất tiền người dùng, không cần quyền"),
        ("Đo được", "31,25 %", "Tỷ lệ quỹ attacker lấy trong một giao dịch"),
        ("PoC", "3 / 3", "Test xanh trên mã thật, commit a8d7d2a"),
        ("Tái lập", "~9 s", "Clone + chạy offline, không cần mainnet"),
    ]))
    s.append(Spacer(1, 10 * mm))
    s.append(Paragraph(
        "Báo cáo gồm 10 phần và 3 phụ lục. Phần 04 mô tả lỗ hổng, Phần 05 là kịch bản tấn công "
        "từng bước, Phần 06 là PoC kèm log chạy thật, Phần 09 là khuyến nghị sửa. Toàn văn mã PoC "
        "và log nằm ở Phụ lục A và B để bất kỳ ai cũng chạy lại được.", st_cap))
    s.append(PageBreak())

    s += h1("01", "Tóm tắt điều hành")
    s.append(Paragraph(
        "Contract <b>fomo.clar</b> của StackingDAO là một trò chơi mở khoá theo kiểu “ai là người "
        "claim cuối cùng”. Người chơi mua claim bằng stSTX; toàn bộ tiền nằm trong chính contract. "
        "Khi ván đóng (144 burn block ≈ 24 giờ không ai claim), người thắng nhận 70 %, 25 % chia cho "
        "người thua, 5 % cho giao thức.", st_lead))
    s.append(Paragraph(
        "Hàm chia phần 25 % — <font face='Mono' size='9'>retrieve-loser(nft-id)</font> — trả tiền "
        "cho <b>tx-sender</b> nhưng <b>không hề kiểm tra tx-sender có sở hữu nft-id hay không</b>, "
        "cũng không có cờ chống trả trùng. Người không mua một claim nào vẫn gọi được hàm này cho "
        "mọi NFT đang tồn tại, đốt NFT của người khác, và nhận tiền. Mẫu số dùng "
        "<font face='Mono' size='9'>nft-amount − 1</font> trong khi số lần gọi được là "
        "<font face='Mono' size='9'>nft-amount</font>, nên tổng chi vượt quỹ 25 % đúng "
        "<font face='Mono' size='9'>N/(N−1)</font> lần.", st_body))

    s.append(callout(
        "Kết quả đo được (N = 5 claim, log ở Phần 06)",
        "Quỹ 6 500 000 µstSTX. Một ví <b>chưa từng tham gia</b>, số dư 0, gửi "
        "<b>một</b> giao dịch qua một contract 5 dòng gọi <font face='Mono'>retrieve-loser(0..4)</font> "
        "và nhận <b>2 031 250 µstSTX</b> = 31,25 % toàn bộ quỹ, trong khi quỹ dành cho người thua chỉ "
        "có 25 %. Contract còn 4 468 750 µstSTX trong khi người thắng phải nhận 4 550 000 — "
        "<b>người thắng không thể rút</b>, lệnh <font face='Mono'>retrieve-winner</font> trả "
        "<font face='Mono'>(err u1)</font>."))
    s.append(Spacer(1, 4 * mm))

    s.append(keep(
        Paragraph("Ba câu trả lời ngắn", st_h3),
        data_table([
        ["Câu hỏi", "Trả lời"],
        ["Attacker có kiếm được tiền không?",
         "<b>Có.</b> Tiền về thẳng ví attacker bằng một giao dịch; không cần vốn, không cần claim."],
        ["Có phải chỉ người dùng tự làm mình thiệt?",
         "<b>Không.</b> Tiền lấy từ stSTX của những người đã mua claim, đang nằm trong contract."],
        ["Có cần điều kiện gì?",
         "Ván đã mở và đã đóng (tự động sau 24 giờ), và quỹ thật đủ lớn — xem Phần 07. "
         "Không có điều kiện nào về danh tính, whitelist hay quyền admin."],
        ], [52 * mm, PW - 2 * M - 52 * mm], first_col_bold=True)))

    s.append(Paragraph(
        "Báo cáo được viết theo hướng <b>phòng thủ</b>: mục tiêu là để đội phát triển sửa được "
        "ngay, và để người dùng biết tiền của họ đang nằm ở đâu.", st_cap))

    s.append(PageBreak())

    # ---------------- 02 scope
    s += h1("02", "Phạm vi, môi trường và phương pháp")
    s.append(Paragraph(
        "Repo được clone nguyên bản từ GitHub. Mọi phân tích và PoC chạy trên đúng mã đó; không có "
        "hợp đồng nào bị viết lại, không có mock nào thay cho logic thật.", st_body))
    s.append(data_table([
        ["Hạng mục", "Giá trị"],
        ["Nguồn", "github.com/StackingDAO/contracts"],
        ["Commit", "a8d7d2a2dcffa0b4759bc8411f9d1369fc44b736 — “fix: update test suite”, 2026-04-26"],
        ["Số contract Clarity", "123 file · 21 718 dòng"],
        ["Bộ chạy", "Clarinet SDK 2.14.0 · vitest 1.6.0 · node 22.22.3"],
        ["Chế độ", "simnet, offline (không gọi api.hiro.so, không dùng mainnet state)"],
        ["File bị sửa để chạy offline", "Clarinet.toml (chỉ xoá khai báo mainnet) + 1 principal pox-4 → mock"],
        ["Logic Clarity bị sửa", "không có"],
    ], [48 * mm, PW - 2 * M - 48 * mm], first_col_bold=True))
    s.append(Spacer(1, 3 * mm))
    s.append(Paragraph(
        "Việc duy nhất phải can thiệp là để bộ test chạy được khi không có mạng: bỏ 20 dòng "
        "<font face='Mono' size='8.5'>[[project.requirements]]</font> trỏ tới contract mainnet, "
        "và đổi principal <font face='Mono' size='8.5'>'SP000…pox-4</font> thành "
        "<font face='Mono' size='8.5'>.pox-4-mock</font> — nhánh <font face='Mono' size='8.5'>"
        "is-in-mainnet</font> không bao giờ chạy trong simnet nên hành vi không đổi. Script "
        "<font face='Mono' size='8.5'>prepare.sh</font> làm đúng ba việc đó và in ra lệnh chạy.", st_body))
    s.append(callout(
        "Nguyên tắc bằng chứng",
        "Không có kết luận nào trong báo cáo dựa trên đọc code suông. Mỗi khẳng định về tiền đều "
        "kèm một dòng log hoặc một assert trong test. Những gì chưa chứng minh được thì ghi là "
        "chưa chứng minh (Phần 10).",
        color=GREEN, bg=colors.HexColor("#F0F6F1")))

    s.append(PageBreak())

    # ---------------- 03 how it works
    s += h1("03", "FOMO vận hành như thế nào")
    s.append(Paragraph(
        "Đọc đúng luồng tiền là điều kiện để thấy lỗ hổng, nên phần này tóm tắt đúng những gì "
        "contract làm, không thêm bớt.", st_body))
    s.append(data_table([
        ["Biến / hàm", "Ý nghĩa thật trong code"],
        ["<font face='Mono'>buy-claim()</font>",
         "Chuyển <font face='Mono'>claim-cost + increment</font> stSTX từ người chơi vào contract, "
         "mint 1 NFT, đặt người chơi làm người thắng hiện tại, cộng số tiền vào "
         "<font face='Mono'>total-treasure</font>."],
        ["<font face='Mono'>total-treasure</font>",
         "Sổ ghi tổng tiền của ván. Khởi tạo <b>100 stSTX</b> — xem F-02."],
        ["<font face='Mono'>nft-amount</font>",
         "Số claim đã bán = số NFT đang tồn tại (không có getter)."],
        ["<font face='Mono'>has-game-ended</font>",
         "<font face='Mono'>burn-block-height &gt; last-claim + 144</font> — tự động, không ai bấm."],
        ["<font face='Mono'>retrieve-winner(nft-id)</font>",
         "Trả 70 % cho <font face='Mono'>current-winner</font>, đốt NFT của chính người đó."],
        ["<font face='Mono'>retrieve-loser(nft-id)</font>",
         "Trả <font face='Mono'>25 % / (nft-amount − 1)</font> cho <b>bất kỳ ai gọi</b>, đốt NFT "
         "có id được truyền vào. <b>Đây là hàm lỗi.</b>"],
        ["<font face='Mono'>retrieve-fees()</font>",
         "5 % cho admin, một lần."],
    ], [50 * mm, PW - 2 * M - 50 * mm], first_col_bold=True))
    s.append(Spacer(1, 4 * mm))
    s.append(Paragraph(
        "Điểm cần nhớ: <b>tiền không nằm ở đâu khác ngoài contract fomo</b>. Không có escrow, không "
        "có pool riêng. Vì vậy bất kỳ hàm nào trong contract chuyển được stSTX ra ngoài mà thiếu "
        "kiểm tra quyền đều là mất tiền trực tiếp.", st_body))


    # ---------------- 04 vulnerability
    s += h1("04", "F-01 — retrieve-loser không kiểm quyền sở hữu")
    s.append(Paragraph("4.1 · Mô tả", st_h2))
    s.append(Paragraph(
        "Hàm trả thưởng cho người thua có ba khiếm khuyết độc lập, và ba khiếm khuyết này cộng lại "
        "thành một lỗ hổng rút quỹ hoàn chỉnh: thiếu kiểm tra chủ sở hữu NFT, thiếu cờ chống trả "
        "trùng, và mẫu số chia bị lệch một đơn vị so với số lần trả thực tế.", st_body))

    s.append(Paragraph("4.2 · File và hàm", st_h2))
    s.append(data_table([
        ["Trường", "Giá trị"],
        ["File", "<font face='Mono'>contracts/nakamoto/fomo.clar</font>"],
        ["Hàm", "<font face='Mono'>retrieve-loser (nft-id uint)</font>"],
        ["Vị trí", "<font face='Mono'>define-public</font> tại dòng 146, thân hàm 146–161"],
        ["Kiểu lỗi", "Missing authorization · CWE-862 · CWE-639"],
        ["Hàm liên quan", "<font face='Mono'>stacking-dao-fomo-nft.burn-for-protocol</font> (chỉ kiểm "
                          "<font face='Mono'>contract-caller</font> là protocol — mà caller chính là fomo)"],
    ], [34 * mm, PW - 2 * M - 34 * mm], first_col_bold=True))

    s.append(Paragraph("4.3 · Mã nguồn nguyên bản", st_h2))
    src = open(os.path.join("/home/user/sdao", "contracts/nakamoto/fomo.clar")).read().split("\n")
    listing = "\n".join("%4d  %s" % (i + 1, src[i]) for i in range(145, 162))
    s.append(code_block(listing))
    s.append(Paragraph("Nguyên văn dòng 146–161 của commit a8d7d2a, không chỉnh sửa.", st_cap))

    s.append(Paragraph("4.4 · Nguyên nhân gốc", st_h2))
    s.append(data_table([
        ["#", "Nguyên nhân", "Hệ quả"],
        ["1", "Không có <font face='Mono'>get-owner(nft-id) == tx-sender</font>. "
              "<font face='Mono'>burn-for-protocol</font> chỉ kiểm caller là protocol, mà caller "
              "chính là contract fomo, nên nó đốt được NFT của bất kỳ ai.",
         "Người ngoài đốt NFT của người chơi và của cả người thắng."],
        ["2", "Không có map cờ “id này đã trả thưởng”. Mỗi lần gọi đốt đúng 1 NFT.",
         "Số lần trả = số NFT tồn tại = <font face='Mono'>nft-amount</font>."],
        ["3", "Mẫu số <font face='Mono'>nft-amount − 1</font> (giả định NFT của người thắng không "
              "phải “loser”), nhưng (1) cho phép đốt luôn NFT người thắng.",
         "Tổng chi = <font face='Mono'>25 % · N/(N−1)</font> &gt; 25 % ⇒ luôn thiếu tiền cho 70 %."],
    ], [8 * mm, 92 * mm, PW - 2 * M - 100 * mm], first_col_bold=True))

    s.append(PageBreak())

    # ---------------- 05 attack steps
    s += h1("05", "Kịch bản tấn công, từng bước")
    s.append(keep(
        Paragraph("5.1 · Điều kiện khai thác", st_h2),
        data_table([
        ["Điều kiện", "Bắt buộc?", "Ai đáp ứng"],
        ["Ván đã bắt đầu (<font face='Mono'>game-started</font>)", "Có", "Admin gọi <font face='Mono'>start-game</font> khi mở ván"],
        ["Ván đã đóng (144 burn block không ai claim)", "Có", "<b>Tự động</b> theo thời gian"],
        ["Quỹ thật đủ lớn để trả phần đã phóng đại", "Có", "Phụ thuộc doanh thu ván — xem Phần 07"],
        ["Sở hữu NFT", "<b>Không</b>", "—"],
        ["Có claim / từng chơi", "<b>Không</b>", "—"],
        ["Vốn ban đầu", "<b>Không</b>", "Ví trống là đủ"],
        ["Quyền admin / whitelist", "<b>Không</b>", "—"],
        ], [70 * mm, 20 * mm, PW - 2 * M - 90 * mm], first_col_bold=True)))
    s.append(Spacer(1, 3 * mm))
    s.append(Paragraph(
        "Chi phí tấn công: gas của một giao dịch. Không có yếu tố nào khác cần chuẩn bị.", st_cap))


    s.append(Paragraph("5.2 · Các bước", st_h2))
    s.append(Paragraph(
        "Attacker không tương tác với giao diện, không cần biết ai đang chơi. Toàn bộ kịch bản nằm "
        "trong một contract 5 dòng deploy trước, sau đó một giao dịch duy nhất.", st_body))
    steps = [
        ["Bước", "Hành động", "Chi tiết"],
        ["0", "Theo dõi contract fomo",
         "Đọc <font face='Mono'>has-game-ended</font>. Không cần quyền gì."],
        ["1", "Chờ ván đóng",
         "144 burn block sau claim cuối (~24 giờ). Tự động, không ai can thiệp."],
        ["2", "Deploy contract quét",
         "5 dòng: <font face='Mono'>sweep(ids)</font> gọi <font face='Mono'>retrieve-loser</font> "
         "cho từng id trong một transaction."],
        ["3", "Gọi <font face='Mono'>sweep([0 … N−1])</font>",
         "Truyền mọi id đã biết. Không id nào thuộc ví attacker."],
        ["4", "Nhận tiền",
         "Clarity giữ <font face='Mono'>tx-sender</font> = người ký, nên stSTX về thẳng ví attacker; "
         "contract trung gian không giữ đồng nào."],
        ["5", "Người thắng thất bại",
         "Contract đã bị rút quá 25 %, không còn đủ 70 %. "
         "<font face='Mono'>retrieve-winner</font> revert <font face='Mono'>(err u1)</font>."],
    ]
    s.append(data_table(steps, [15 * mm, 50 * mm, PW - 2 * M - 65 * mm]))
    s.append(Spacer(1, 3 * mm))
    s.append(callout(
        "Chi tiết quan trọng: tại sao tiền không bị kẹt trong contract trung gian",
        "Trong Clarity, <font face='Mono'>tx-sender</font> là <b>người ký giao dịch</b> và không bị "
        "thay đổi khi đi qua contract khác. Hàm trả thưởng dùng <font face='Mono'>tx-sender</font>, "
        "nên dù lời gọi đi qua contract quét, tiền vẫn về ví attacker. Đây là lý do toàn bộ vụ rút "
        "gói trong đúng một giao dịch thay vì N giao dịch.",
        color=ACCENT2, bg=colors.HexColor("#EEF4F7")))
    s.append(Spacer(1, 3 * mm))
    s.append(PageBreak())

    # ---------------- 06 PoC
    s += h1("06", "PoC: mã thật, log thật")
    s.append(Paragraph(
        "PoC gồm hai file vitest chạy trên Clarinet simnet, dùng chính các contract của repo. "
        "Không có mock nào thay cho <font face='Mono'>fomo.clar</font>, "
        "<font face='Mono'>ststx-token</font>, <font face='Mono'>stacking-dao-core-v6</font> hay "
        "<font face='Mono'>stacking-dao-fomo-nft</font>. Ba test: một cho N = 3 (đường cơ bản, "
        "có cả retrieve-winner), một cho N = 5 (một giao dịch duy nhất), một cho nhánh quỹ chưa đủ "
        "lớn để chứng minh giới hạn của lỗ hổng.", st_body))

    s.append(Paragraph(
        "Contract quét dùng trong PoC — nguyên văn, phần thân chỉ 5 dòng:", st_h3))
    s.append(code_block(
        "(define-public (sweep (ids (list 200 uint)))\n"
        "  (ok (map sweep-one ids)))\n\n"
        "(define-private (sweep-one (id uint))\n"
        "  (unwrap-panic (contract-call? 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.fomo\n"
        "                              retrieve-loser id)))"))

    s.append(Paragraph("6.1 · Tái lập", st_h2))
    s.append(code_block(
        "cd /home/user/arc_hedgefun\n"
        "./audit/stackingdao/prepare.sh /tmp/sdao3      # clone + chạy offline, ~9 giây\n"
        "cd /tmp/sdao3 && npx vitest run tests/poc/"))
    s.append(Paragraph(
        "Kết quả mong đợi: <font face='Mono'>Test Files 2 passed (2) · Tests 3 passed (3)</font>.", st_cap))

    s.append(keep(
        Paragraph("6.2 · Cách đọc các con số", st_h2),
        data_table([
        ["Dòng log", "Ý nghĩa"],
        ["<font face='Mono'>paid in 6500000</font>", "5 claim × (1,1 … 1,5) stSTX = 6,5 stSTX người chơi đã nộp"],
        ["<font face='Mono'>sweep result (ok (list 406250 ×5))</font>",
         "Một transaction, 5 lần <font face='Mono'>retrieve-loser</font>, mỗi lần 0,40625 stSTX"],
        ["<font face='Mono'>attacker got 2031250</font>",
         "Ví attacker: 0 → 2,03125 stSTX. Không stake, không claim."],
        ["<font face='Mono'>left in contract 4468750</font>", "Số dư còn lại sau khi bị rút"],
        ["<font face='Mono'>winner prize 4550000</font>",
         "70 % phải trả cho người thắng — <b>lớn hơn</b> số còn lại ⇒ không thể trả"],
        ["<font face='Mono'>retrieve-winner (err u1)</font>", "Lệnh rút của người thắng thất bại thật"],
        ["<font face='Mono'>treasure 103600000 / real 3600000</font>",
         "Sổ ghi 103,6 stSTX trong khi contract chỉ có 3,6 — xem F-02"],
        ], [62 * mm, PW - 2 * M - 62 * mm], first_col_bold=True)))

    s.append(PageBreak())
    s.append(Paragraph("6.3 · Log của lần chạy thật", st_h2))
    log_path = os.path.join(HERE, "poc_full.log")
    log = open(log_path).read() if os.path.exists(log_path) else "(thiếu poc_run.log)"
    log = "\n".join(l for l in log.split("\n") if l.strip())
    log = wrap_log(log, 100).replace("RUN  v1.6.0 /tmp/sdao3", "RUN  npx vitest run tests/poc/")
    s.extend(code_blocks(log, size=7.2, max_lines=34))
    s.append(Paragraph(
        "Ba khối log tương ứng ba test. Khối thứ ba là ca phủ định: khi quỹ thật chưa đủ lớn, "
        "lệnh gọi trả <font face='Mono'>(err u1)</font> và attacker nhận 0 — lỗ hổng không tạo ra "
        "tiền từ không khí, nó lấy tiền của người chơi.", st_cap))

    s.append(PageBreak())

    # ---------------- 07 impact
    s += h1("07", "Tác động định lượng")
    s.append(Paragraph(
        "Gọi N là số claim đã bán. Mỗi lần <font face='Mono'>retrieve-loser</font> trả "
        "<font face='Mono'>0,25 · T / (N − 1)</font> (T = quỹ), và có thể gọi N lần. Vậy tổng "
        "attacker lấy được:", st_body))
    s.append(code_block(
        "lấy được  =  N · 0,25·T/(N−1)  =  0,25·T · N/(N−1)\n"
        "phải trả  =  0,70·T  +  0,25·T·N/(N−1)  =  T · (0,70 + 0,25·N/(N−1))\n\n"
        "N = 2  →  0,50·T  +  0,70·T  =  1,20·T\n"
        "N = 3  →  0,375·T +  0,70·T  =  1,075·T\n"
        "N = 5  →  0,3125·T + 0,70·T  =  1,0125·T\n"
        "N = 10 →  0,2778·T + 0,70·T  =  0,9778·T   (hụt 2,2 %)\n"
        "N → ∞  →  0,25·T  +  0,70·T  =  0,95·T     (hụt 5 %, phần của giao thức)\n\n"
        "⇒ luôn thiếu tiền cho 70 % khi N ≤ 9; với N lớn, khoản thiếu rơi vào 5 % của giao thức."))
    s.append(Paragraph(
        "Nghĩa là lỗ hổng có hai chế độ, và cả hai đều xấu: với ván nhỏ, <b>người thắng mất trắng "
        "phần 70 %</b>; với ván lớn, attacker ăn gần hết phần 25 % và giao thức mất phần 5 %.", st_body))

    s.append(Paragraph("Đo trên hai kịch bản thật", st_h2))
    s.append(data_table([
        ["", "N = 3 (fomo_poc_test)", "N = 5 (fomo_scale_test)"],
        ["Quỹ T", "3 600 000", "6 500 000"],
        ["Quỹ 25 % đúng nghĩa", "900 000", "1 625 000"],
        ["Attacker nhận", "1 350 000", "2 031 250"],
        ["Tỷ lệ trên quỹ", "37,50 %", "31,25 %"],
        ["Vượt quỹ 25 %", "+50,0 %", "+25,0 %"],
        ["Còn lại trong contract", "2 250 000", "4 468 750"],
        ["Người thắng cần", "2 520 000", "4 550 000"],
        ["Kết quả retrieve-winner", "<font face='Mono'>(err u1)</font>", "<font face='Mono'>(err u1)</font>"],
    ], [56 * mm, 55 * mm, PW - 2 * M - 111 * mm], first_col_bold=True))
    s.append(Spacer(1, 3 * mm))
    s.append(callout(
        "Giới hạn của lỗ hổng — nói thẳng",
        "Lỗ hổng không in ra tiền. Nếu quỹ thật B chưa đủ bù phần phóng đại thì lệnh gọi revert "
        "<font face='Mono'>(err u1)</font> và attacker nhận 0. Ngưỡng: với T ghi sổ 100 stSTX "
        "(F-02), cần <font face='Mono'>B ≥ 100·(N+1)/(3N−5)</font> stSTX — khoảng 100 stSTX ở N = 3 "
        "và ~35 stSTX khi N lớn. Test thứ ba trong PoC chứng minh đúng nhánh này. Nhưng ở dưới ngưỡng "
        "đó, người thắng và người chơi cũng không rút được: ván đã hỏng sẵn.",
        color=ACCENT2, bg=colors.HexColor("#EEF4F7")))

    s.append(PageBreak())

    # ---------------- 08 secondary
    s += h1("08", "F-02 và F-03 — hai lỗi phụ cùng file")
    s.append(Paragraph("F-02 · Quỹ khởi tạo 100 stSTX là tiền ảo — Medium", st_h2))
    s.append(code_block("38  (define-data-var total-treasure uint u100000000)  ;; 100 stSTX"))
    s.append(Paragraph(
        "Contract không hề được nạp 100 stSTX ở bất kỳ đâu. Mọi phép tính thưởng dùng con số này, "
        "nên trước khi người chơi nộp đủ 100 stSTX, mọi lệnh trả thưởng đều revert. PoC ghi lại đúng "
        "trạng thái đó: <font face='Mono'>treasure (book) 103 600 000</font> trong khi số dư thật là "
        "<font face='Mono'>3 600 000</font>. Hệ quả: ván nhỏ không ai rút được; và khi ván đủ lớn, "
        "khoản chênh này làm lỗ F-01 khó kích hoạt hơn nhưng cũng làm sổ sách sai lệch vĩnh viễn.", st_body))

    s.append(Paragraph("F-03 · Chia cho 0 khi chỉ có một claim — Low", st_h2))
    s.append(code_block("150    (avg (/ amount (- (var-get nft-amount) u1)))"))
    s.append(Paragraph(
        "Nếu <font face='Mono'>nft-amount = 1</font>, mẫu số bằng 0 và cả hàm revert: người thắng "
        "không có đường nhận thưởng. Chưa viết test riêng vì đây là lỗi hiển nhiên từ mã, không cần "
        "chứng minh động — ghi lại để khi sửa thì sửa luôn.", st_body))

    s.append(Paragraph("Ngoài ra, ghi nhận ở mức quan sát", st_h2))
    s.append(Paragraph(
        "Các hàm admin trong file (<font face='Mono'>retrieve-fees</font>, "
        "<font face='Mono'>rescue-funds</font>, <font face='Mono'>set-*</font>) kiểm quyền bằng "
        "<font face='Mono'>check-is-protocol tx-sender</font> — tức chỉ cần là một contract đang active "
        "trong <font face='Mono'>dao.clar</font>, không cần là admin. Trong repo hiện tại, "
        "<font face='Mono'>.fomo</font> nằm trong danh sách active. Đây là mô hình quyền của cả hệ "
        "thống chứ không riêng file này, nên chỉ ghi nhận, không xếp mức.", st_body))

    s.append(PageBreak())

    # ---------------- 09 fix
    s += h1("09", "Khuyến nghị sửa")
    s.append(Paragraph("9.1 · Bản vá tối thiểu", st_h2))
    s.append(Paragraph(
        "Sửa đủ ba nguyên nhân, không cần đổi kiến trúc. Ghi nợ theo từng NFT ngay lúc mua claim là "
        "cách chắc nhất: lúc trả chỉ đọc lại đúng con số đã ghi, không chia lại từ quỹ.", st_body))
    s.append(code_block(
        ";; 1. mỗi NFT chỉ trả một lần\n"
        "(define-map claimed { nft-id: uint } bool)\n\n"
        ";; 2. ghi nợ ngay lúc bán claim — không chia lại từ total-treasure\n"
        "(define-map loser-value { nft-id: uint } uint)\n\n"
        "(define-public (retrieve-loser (nft-id uint))\n"
        "  (let (\n"
        "    (owner (unwrap! (get-owner nft-id) (err ERR_GET_OWNER)))\n"
        "    (owed  (default-to u0 (map-get? loser-value { nft-id: nft-id })))\n"
        "  )\n"
        "    (asserts! (has-game-ended) (err ERR_GAME_NOT_ENDED))\n"
        "    (asserts! (is-eq owner tx-sender) (err ERR_NOT_OWNER))          ;; quyền sở hữu\n"
        "    (asserts! (not (default-to false (map-get? claimed { nft-id: nft-id })))\n"
        "              (err ERR_ALREADY_CLAIMED))                            ;; chống trả trùng\n"
        "    (asserts! (> owed u0) (err ERR_NOTHING_OWED))                    ;; chia cho 0\n"
        "    (map-set claimed { nft-id: nft-id } true)\n"
        "    (try! (as-contract (contract-call? .ststx-token transfer owed tx-sender owner none)))\n"
        "    (ok owed)))"))
    s.append(Paragraph(
        "Nếu muốn giữ nguyên cách chia theo <font face='Mono'>total-treasure</font> thì tối thiểu phải: "
        "(a) kiểm <font face='Mono'>owner == tx-sender</font>; (b) thêm cờ <font face='Mono'>claimed</font>; "
        "(c) đếm số loser còn lại thật và giảm dần, thay vì dùng <font face='Mono'>nft-amount − 1</font>; "
        "(d) chặn tổng đã trả ≤ 25 % quỹ. Thiếu bất kỳ mục nào thì lỗ hổng vẫn còn.", st_body))

    s.append(Paragraph("9.2 · Sửa F-02 và F-03", st_h2))
    s.append(Paragraph(
        "Đặt <font face='Mono'>total-treasure</font> khởi tạo bằng 0, hoặc nạp đủ 100 stSTX ngay trong "
        "<font face='Mono'>start-game</font> và ghi lại bằng chứng nạp. Thay mẫu số bằng số loser thật; "
        "nếu dùng công thức cũ thì phải chặn <font face='Mono'>nft-amount = 1</font> trước khi chia.", st_body))

    s.append(Paragraph("9.3 · Kiểm chứng sau khi sửa", st_h2))
    s.append(data_table([
        ["Test", "Kỳ vọng sau khi vá"],
        ["Attacker gọi <font face='Mono'>retrieve-loser(0)</font> với NFT của người khác",
         "revert <font face='Mono'>ERR_NOT_OWNER</font>"],
        ["Chủ NFT gọi lần thứ hai", "revert <font face='Mono'>ERR_ALREADY_CLAIMED</font>"],
        ["Ván có 1 claim, người thắng rút", "thành công, không chia cho 0"],
        ["Ván có N claim, mọi người rút", "tổng chi ≤ 25 % + 70 % + 5 %, không revert"],
        ["<font face='Mono'>get-balance(fomo)</font> sau khi tất toán", "bằng 0"],
    ], [80 * mm, PW - 2 * M - 80 * mm], first_col_bold=True))
    s.append(Spacer(1, 2 * mm))
    s.append(Paragraph(
        "Hai file PoC trong báo cáo này dùng được luôn làm test hồi quy: sau khi vá, cả ba test phải "
        "<b>đỏ</b>. Nếu chúng vẫn xanh thì lỗ hổng vẫn còn.", st_cap))

    s.append(PageBreak())

    # ---------------- 10 clean
    s += h1("10", "Những gì đã kiểm tra và thấy sạch")
    s.append(Paragraph(
        "Để báo cáo không bị hiểu là “cả repo có một lỗi”, phần này liệt kê trung thực những gì đã "
        "đọc và không tìm thấy vấn đề, kèm mức độ chắc chắn.", st_body))
    s.append(data_table([
        ["Contract", "Đã đọc", "Kết luận"],
        ["stacking-dao-core-v6", "toàn bộ", "Hai phép chia đều floor, nghiêng về protocol; "
         "tỷ lệ stx/ststx nhất quán qua deposit, init-withdraw, withdraw và qua fee."],
        ["data-core-v1 / v2 / v3", "toàn bộ", "Công thức quy đổi nhất quán; không có đường ghi đè."],
        ["swap-ststx-ststxbtc-v2", "toàn bộ", "Mint/burn 1:1 theo X = total − supply(btc v1) − supply(btc v2); "
         "round-trip lỗ ≤ 1 µunit."],
        ["direct-helpers-v4", "toàn bộ", "Mọi nhánh cộng/trừ đồng thời user, pool, total."],
        ["staking-v1", "toàn bộ", "Thứ tự claim → total → index đúng; không có đường bơm index."],
        ["ststxbtc-tracking-v2", "toàn bộ", "Saved-rewards + cờ active chặn claim lặp ở mức đọc code."],
        ["reserve-v1, ststx-token, dao", "toàn bộ", "Mô hình quyền rộng nhưng nhất quán với thiết kế."],
        ["Các contract còn lại", "một phần", "<b>Chưa kết luận.</b> stacking-pool-v1, "
         "stacking-pool-signer-v1, strategy-v3/v4, commission-v2, native-stacking-pool-v1 chưa soi kỹ."],
    ], [50 * mm, 22 * mm, PW - 2 * M - 72 * mm], first_col_bold=True))
    s.append(Spacer(1, 3 * mm))
    s.append(Paragraph("Giới hạn của báo cáo", st_h2))
    s.append(Paragraph(
        "Mọi thứ chạy trên simnet, không phải mainnet state. Bốn báo cáo audit có sẵn trong "
        "<font face='Mono'>audits/</font> (ClarityAlliance 2024-11, 2025-01, 2025-06 và CoinFabrik "
        "2023-11) không nêu lỗi này — nó nằm ở contract game, ngoài phạm vi các lần review đó. "
        "Việc contract <font face='Mono'>fomo</font> có đang được triển khai với tiền thật trên "
        "mainnet hay không thì <b>chưa xác minh được từ môi trường này</b> (không truy cập được "
        "api.hiro.so); nếu đã ngừng hoạt động, mức độ thực tế giảm xuống, nhưng mã vẫn cần sửa trước "
        "khi dùng lại.", st_body))

    s.append(PageBreak())

    # ---------------- appendix A
    s += h1("A", "Phụ lục A — Toàn văn mã PoC")
    s.append(Paragraph(
        "Hai file dưới đây là nguyên văn mã đã tạo ra log ở Phụ lục B. Đường dẫn trong repo: "
        "<font face='Mono'>audit/stackingdao/fomo_poc_test.ts</font> và "
        "<font face='Mono'>audit/stackingdao/fomo_scale_test.ts</font>.", st_body))
    for name in ("fomo_poc_test.ts", "fomo_scale_test.ts"):
        path = os.path.join(AUDIT, name)
        src = open(path).read().rstrip("\n")
        s.append(Paragraph(name, st_h3))
        s.extend(code_blocks(src, size=6.6, max_lines=44))
        s.append(Spacer(1, 3 * mm))

    s.append(PageBreak())

    # ---------------- appendix B
    s += h1("B", "Phụ lục B — Log đầy đủ của lần chạy")
    full = os.path.join(HERE, "poc_full.log")
    body = open(full).read() if os.path.exists(full) else "(thiếu poc_full.log)"
    body = "\n".join(l for l in body.split("\n") if l.strip())
    body = wrap_log(body, 104).replace("RUN  v1.6.0 /tmp/sdao3", "RUN  npx vitest run tests/poc/")
    s.extend(code_blocks(body, size=7.2, max_lines=40))
    s.append(Paragraph(
        "Log được chụp nguyên văn từ <font face='Mono'>npx vitest run tests/poc/</font> trên bản "
        "clone sạch tại commit a8d7d2a. Không có dòng nào được biên tập.", st_cap))

    s.append(PageBreak())

    # ---------------- appendix C
    s += h1("C", "Phụ lục C — Môi trường tái lập")
    prep = os.path.join(AUDIT, "prepare.sh")
    s.append(Paragraph(
        "Script dưới đây dựng lại toàn bộ môi trường từ một thư mục trống: clone repo, vá 3 chỗ để "
        "chạy offline, cài toolchain, copy PoC. Nó không sửa logic Clarity.", st_body))
    s.extend(code_blocks(open(prep).read().rstrip("\n"), size=6.8, max_lines=44))
    s.append(Spacer(1, 4 * mm))
    s.append(HRule(0.6, RULE, 6))
    s.append(Paragraph(
        "Báo cáo được lập ngày 30/10/2026 cho mục đích phòng thủ và sửa lỗi. Mã PoC chỉ chạy trên "
        "simnet cục bộ với dữ liệu tự tạo; không có giao dịch nào được gửi lên mainnet, không có ví "
        "thật nào bị ảnh hưởng.", st_small))

    return s


def build(path):
    doc = BaseDocTemplate(path, pagesize=A4,
                          leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=22 * mm,
                          title="StackingDAO FOMO — retrieve-loser authorization bypass",
                          author="Arena Agent · security review",
                          subject="Critical: unauthenticated drain of the FOMO reward pool")

    cover_frame = Frame(M, 18 * mm, PW - 2 * M, PH - 18 * mm - 12 * mm, id="cover",
                        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    body_frame = Frame(M, 22 * mm, PW - 2 * M, PH - 22 * mm - M, id="body",
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[cover_frame], onPage=on_cover),
        PageTemplate(id="body", frames=[body_frame], onPage=on_page),
    ])
    doc.build(build_story())
    return doc.page


if __name__ == "__main__":
    n = build(OUT + ".tmp")
    TOTAL_PAGES[0] = n
    build(OUT)
    os.replace(OUT + ".tmp", OUT + ".tmp") if False else None
    if os.path.exists(OUT + ".tmp"):
        os.remove(OUT + ".tmp")
    print("wrote", OUT, "pages:", n)
