// tests/constancia.test.js — el generador de la constancia de entrega (RRH-12)
// produce un PDF real de una página con los campos del acuse tal cual.
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generarConstanciaPdf } from "../src/lib/constancia.js";

const DATOS = {
  numero: "BOL-NEG-202607-001-45231876",
  campos: [
    ["Trabajador", "ROSA QUISPE HUAMÁN — DNI 45231876"],
    ["Empresa emisora", "NEGLIAF S.R.L. — RUC 20605159398"],
    ["Documento entregado", "Boleta de pago — Julio 2026"],
    ["Lote", "BOL-NEG-202607-001"],
    ["Fecha y hora (reloj del servidor, GMT-5)", "2026-08-01 19:32"],
    ["Dirección IP de origen", "181.65.212.44"],
    ["Dispositivo y navegador", "Android 12 · Chrome Mobile"],
    ["Modalidad del acuse", "Personal, sesión autenticada"],
    ["Versión del documento", "v1 — sin correcciones posteriores"],
    ["Hash SHA-256 del archivo entregado", "3f1a9c7e2b8d4a6f0c5e1b7a9d3f8c2e6a4b0d9f1c7e3a5b8d2f6c0e4a9b1d7f"],
  ],
  declaracion: "Declaro haber recibido mi boleta de pago del periodo indicado y haber podido revisar su contenido.",
};

describe("generarConstanciaPdf", () => {
  it("devuelve un PDF válido de una página", async () => {
    const bytes = await generarConstanciaPdf(DATOS);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it("el acuse asistido agrega su nota expresa sin romper el PDF", async () => {
    const bytes = await generarConstanciaPdf({
      ...DATOS,
      notaAsistido: "Acuse asistido: registrado por Julio Mamani (motivo: Sin celular), con cargo firmado adjunto. No se presenta como acuse propio.",
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("tolera valores nulos o vacíos en los campos (dato demo incompleto)", async () => {
    const bytes = await generarConstanciaPdf({
      numero: "X-1", campos: [["Fecha", null], ["IP", ""]], declaracion: "",
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });
});
