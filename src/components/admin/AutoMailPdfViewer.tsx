import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Minus, PanelLeft, Plus, Printer } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useMailVisible } from './AutoMailHtmlBody';

export function PdfPage({ document, page, thumbnail = false, width }: { document: PDFDocumentProxy; page: number; thumbnail?: boolean; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setError('');
    void document.getPage(page).then(async pdfPage => {
      if (!live || !ref.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: (thumbnail ? 260 : Math.min(3000, (width || 1000) * Math.min(devicePixelRatio, 2))) / base.width });
      const canvas = ref.current;
      canvas.width = viewport.width; canvas.height = viewport.height;
      render = pdfPage.render({ canvas, viewport });
      await render.promise;
    }).catch(() => { if (live) setError('Preview unavailable. Download to open.'); });
    return () => { live = false; render?.cancel(); };
  }, [document, page, thumbnail, width]);
  return error ? <p className="p-3 text-xs text-slate-500">{error}</p> : <canvas ref={ref} aria-label={`PDF page ${page}`} className="block h-auto w-full bg-white shadow" />;
}

function Thumbnail({ document, page, selected, onSelect }: { document: PDFDocumentProxy; page: number; selected: boolean; onSelect: () => void }) {
  const { ref, visible } = useMailVisible();
  return <div ref={ref}><button type="button" aria-label={`Go to PDF page ${page}`} aria-current={selected ? 'page' : undefined} onClick={onSelect} className={`mb-3 w-full rounded-lg border-2 p-1 text-xs ${selected ? 'border-sky-400 bg-sky-950' : 'border-transparent hover:bg-white/10'}`}>
    <span className="mb-1 block">{page}</span>{visible && <PdfPage document={document} page={page} thumbnail />}
  </button></div>;
}

export function AutoMailPdfViewer({ document: pdf, fullScreen, name }: { document: PDFDocumentProxy; fullScreen: boolean; name: string }) {
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [thumbnails, setThumbnails] = useState(true);
  const [availableWidth, setAvailableWidth] = useState(800), [url, setUrl] = useState(''), [printing, setPrinting] = useState(false), [error, setError] = useState('');
  const scroller = useRef<HTMLDivElement>(null), printFrame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: 0, left: 0 }); }, [page]);
  useEffect(() => {
    let live = true, objectUrl = '';
    void pdf.getData().then(bytes => { if (live) { objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })); setUrl(objectUrl); } }).catch(() => {});
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); printFrame.current?.remove(); printFrame.current = null; };
  }, [pdf]);
  const changePage = (value: number) => { if (Number.isFinite(value)) setPage(Math.min(pdf.numPages, Math.max(1, Math.trunc(value)))); };
  const print = async () => {
    if (printing) return;
    setPrinting(true); setError('');
    printFrame.current?.remove();
    const frame = window.document.createElement('iframe');
    frame.dataset.mailPrint = 'true'; frame.title = `Print ${name}`;
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
    (scroller.current?.closest('dialog') || window.document.body).append(frame);
    printFrame.current = frame;
    try {
      const doc = frame.contentDocument!;
      doc.open(); doc.write('<!doctype html><html><head><style>@page{margin:10mm}body{margin:0}canvas{display:block;width:100%;height:auto;max-height:270mm;object-fit:contain;break-after:page}canvas:last-child{break-after:auto}</style></head><body></body></html>'); doc.close(); doc.title = name;
      for (let index = 1; index <= pdf.numPages; index++) {
        if (!frame.isConnected) return;
        const pdfPage = await pdf.getPage(index), base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: 1200 / base.width });
        const canvas = doc.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height; doc.body.append(canvas);
        await pdfPage.render({ canvas, viewport }).promise;
      }
      if (!frame.isConnected) return;
      frame.contentWindow!.addEventListener('afterprint', () => { frame.remove(); if (printFrame.current === frame) printFrame.current = null; }, { once: true });
      frame.contentWindow!.focus(); frame.contentWindow!.print();
    } catch { frame.remove(); setError('Unable to print this PDF. Open it in a new tab to print.'); }
    finally { setPrinting(false); }
  };
  const controls = <div aria-label="PDF controls" className={`flex shrink-0 flex-wrap items-center justify-center gap-2 border-t px-2 py-2 text-xs ${fullScreen ? 'border-white/10 bg-[#303134] text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
    {fullScreen && <button type="button" aria-label="Toggle page thumbnails" aria-pressed={thumbnails} onClick={() => setThumbnails(value => !value)} className="rounded p-2 hover:bg-white/10"><PanelLeft size={18} /></button>}
    <button type="button" aria-label="Previous PDF page" disabled={page === 1} onClick={() => changePage(page - 1)} className="rounded-full p-1 disabled:opacity-30"><ChevronLeft size={20} /></button>
    <label className="flex items-center gap-1">Page <input aria-label="PDF page number" type="number" min={1} max={pdf.numPages} value={page} onChange={event => { if(event.target.value)changePage(Number(event.target.value)); }} className="w-12 rounded border border-current/20 bg-transparent p-1 text-center" /> of {pdf.numPages}</label>
    <button type="button" aria-label="Next PDF page" disabled={page === pdf.numPages} onClick={() => changePage(page + 1)} className="rounded-full p-1 disabled:opacity-30"><ChevronRight size={20} /></button>
    <button type="button" aria-label="Zoom out" disabled={zoom <= .25} onClick={() => setZoom(value => Math.max(.25, value - .25))} className="rounded p-1 disabled:opacity-30"><Minus size={18} /></button>
    <button type="button" aria-label="Fit PDF to width" onClick={() => setZoom(1)} className="min-w-12 rounded px-1 py-2">{Math.round(zoom * 100)}%</button>
    <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))} className="rounded p-1 disabled:opacity-30"><Plus size={18} /></button>
    <button type="button" aria-label="Print PDF" disabled={printing} onClick={() => void print()} className="rounded p-2 disabled:opacity-40"><Printer size={18} /></button>
    {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open PDF in new tab" title="Open PDF in new tab" className="rounded p-2"><ExternalLink size={18} /></a>}
    {printing && <span role="status">Preparing print…</span>}
  </div>;
  const width = Math.max(100, Math.min(1000, availableWidth - 32)) * zoom;
  return <div className={`flex h-full min-h-0 flex-col ${fullScreen ? 'bg-[#202124] text-white' : 'bg-slate-100'}`}>
    {fullScreen && controls}
    {error && <p role="alert" className="px-3 py-2 text-xs text-red-500">{error}</p>}
    <div className="flex min-h-0 flex-1">
      {fullScreen && thumbnails && <aside aria-label="PDF page thumbnails" className="w-24 shrink-0 overflow-y-auto border-r border-white/10 p-2 sm:w-36">{Array.from({ length: pdf.numPages }, (_, index) => <Thumbnail key={index} document={pdf} page={index + 1} selected={page === index + 1} onSelect={() => changePage(index + 1)} />)}</aside>}
      <div ref={scroller} aria-label="PDF document pages" className="min-h-0 min-w-0 flex-1 overflow-auto p-4"><div className="mx-auto" style={{ width, minWidth: width }}><PdfPage document={pdf} page={page} width={width} /></div></div>
    </div>
    {!fullScreen && controls}
  </div>;
}
