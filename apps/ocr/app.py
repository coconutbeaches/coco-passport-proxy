# Minimal OCR FastAPI service
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR
from dateutil import parser as dateparser
import cv2, numpy as np, re

app = FastAPI(title="Coco Passport OCR", version="1.0.0")
ocr = PaddleOCR(lang="en")

def imread_upload(f: UploadFile):
    data = f.file.read()
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)

def preprocess(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.GaussianBlur(g, (3,3), 0)
    _, thr = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thr

def ocr_lines(img):
    res = ocr.ocr(img, cls=True)
    return [(det[1][0], float(det[1][1])) for det in res[0]]

@app.post("/passport-ocr")
async def passport_ocr(images: list[UploadFile] = File(...), default_checkout: str | None = Form(None)):
    guests, rows = [], []
    for f in images:
        img = imread_upload(f)
        proc = preprocess(img)
        lines = ocr_lines(proc)
        # For now, dump raw lines to prove it works
        guests.append({"lines": lines})
        rows.append("UNKNOWN\t\t\t\t\t\t\t")
    guests_tsv = "\n".join(rows)
    return JSONResponse({"guests_tsv": guests_tsv, "guests": guests})
