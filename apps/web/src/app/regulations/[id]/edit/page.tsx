"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  ARTICLE_TYPES,
  CATEGORIES,
  DiffModal,
  EMPTY_FORM,
  PublishModal,
  WF_COLORS,
  WF_LABELS,
  buildLawTree,
  flattenTree,
  type LawNode,
  type NewArtForm,
} from "@/components/regulations/RegulationEditParts";
import LawTreeEditor, { inferParentIdByPrevious } from "@/components/regulations/LawTreeEditor";
import { ArticleDrawer } from "@/components/regulations/ArticleDrawer";
import SmartTextarea from "@/components/ui/SmartTextarea";
import { usePermissions } from "@/hooks/usePermissions";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import { useOnlineAutosave } from "@/hooks/useOnlineAutosave";
import { ApiError, regulationsApi, regulationHref, serialTemplatesApi } from "@/lib/api";
import { ARTICLE_TYPE_LABEL, canNestInside } from "@/lib/regulationStructure";
import type {
  ArticleType,
  RegulationAmendmentType,
  RegulationArticleOut,
  RegulationCategory,
  RegulationOut,
  SerialTemplateOut,
} from "@/lib/types";

// ── 主頁面 ────────────────────────────────────────────────────────────────────

type RegulationEditDraft = {
  title: string;
  category: RegulationCategory;
  preface: string;
  content: string;
  amendmentType: RegulationAmendmentType;
  amendedArticlesInput: string;
  effectiveDate: string;
  legislativeHistory: string;
  legalBasis: string;
  proposalMetadata: string;
  publishSummary: string;
  publishAmendDesc: string;
  publishSerialTemplateId: string;
  publishManualSerialNumber: string;
  articles: RegulationArticleOut[];
  addingEnd: boolean;
  endForm: NewArtForm;
};

export default function EditRegulationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const [reg, setReg] = useState<RegulationOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [structuringContent, setStructuringContent] = useState(false);

  // 基本資訊
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RegulationCategory>("ordinance");
  const [preface, setPreface] = useState("");
  const [content, setContent] = useState("");
  const [amendmentType, setAmendmentType] = useState<RegulationAmendmentType>("enact");
  const [amendedArticlesInput, setAmendedArticlesInput] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [legislativeHistory, setLegislativeHistory] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [proposalMetadata, setProposalMetadata] = useState("");
  const [publishSummary, setPublishSummary] = useState("");
  const [publishAmendDesc, setPublishAmendDesc] = useState("");
  const [publishSerialTemplates, setPublishSerialTemplates] = useState<SerialTemplateOut[]>([]);
  const [publishSerialTemplateId, setPublishSerialTemplateId] = useState("");
  const [publishManualSerialNumber, setPublishManualSerialNumber] = useState("");

  // 條文狀態
  const [articles, setArticles] = useState<RegulationArticleOut[]>([]);
  const [collapsedMap] = useState<Record<string, boolean>>({});
  const [editingArt, setEditingArt] = useState<RegulationArticleOut | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showPublish, setShowPublish] = useState(false);

  // 插入狀態
  const [inserting, setInserting] = useState(false);

  // 尾部新增表單
  const [addingEnd, setAddingEnd] = useState(false);
  const [endForm, setEndForm] = useState<NewArtForm>(EMPTY_FORM);
  const currentRegHref = reg ? regulationHref(reg) : `/regulations/${encodeURIComponent(id)}`;
  const draftValue = useMemo<RegulationEditDraft>(() => ({
    title,
    category,
    preface,
    content,
    amendmentType,
    amendedArticlesInput,
    effectiveDate,
    legislativeHistory,
    legalBasis,
    proposalMetadata,
    publishSummary,
    publishAmendDesc,
    publishSerialTemplateId,
    publishManualSerialNumber,
    articles,
    addingEnd,
    endForm,
  }), [
    addingEnd,
    amendedArticlesInput,
    amendmentType,
    articles,
    category,
    content,
    effectiveDate,
    endForm,
    legalBasis,
    legislativeHistory,
    preface,
    proposalMetadata,
    publishAmendDesc,
    publishManualSerialNumber,
    publishSerialTemplateId,
    publishSummary,
    title,
  ]);
  const originalDraft = useMemo<RegulationEditDraft | null>(() => {
    if (!reg) return null;
    return {
      title: reg.title,
      category: reg.category,
      preface: reg.preface ?? "",
      content: reg.content ?? "",
      amendmentType: reg.amendment_type,
      amendedArticlesInput: (reg.amended_articles ?? "")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean)
        .join("\n"),
      effectiveDate: reg.effective_date ? reg.effective_date.slice(0, 10) : "",
      legislativeHistory: reg.legislative_history ?? "",
      legalBasis: reg.legal_basis ?? "",
      proposalMetadata: reg.proposal_metadata ?? "",
      publishSummary: "",
      publishAmendDesc: "",
      publishSerialTemplateId: "",
      publishManualSerialNumber: "",
      articles: [...reg.articles]
        .filter(a => !a.is_deleted)
        .sort((a, b) => a.sort_index - b.sort_index),
      addingEnd: false,
      endForm: EMPTY_FORM,
    };
  }, [reg]);
  const restoreDraft = useCallback((draft: RegulationEditDraft) => {
    setTitle(draft.title ?? "");
    setCategory(draft.category ?? "ordinance");
    setPreface(draft.preface ?? "");
    setContent(draft.content ?? "");
    setAmendmentType(draft.amendmentType ?? "enact");
    setAmendedArticlesInput(draft.amendedArticlesInput ?? "");
    setEffectiveDate(draft.effectiveDate ?? "");
    setLegislativeHistory(draft.legislativeHistory ?? "");
    setLegalBasis(draft.legalBasis ?? "");
    setProposalMetadata(draft.proposalMetadata ?? "");
    setPublishSummary(draft.publishSummary ?? "");
    setPublishAmendDesc(draft.publishAmendDesc ?? "");
    setPublishSerialTemplateId(draft.publishSerialTemplateId ?? "");
    setPublishManualSerialNumber(draft.publishManualSerialNumber ?? "");
    setArticles(draft.articles ?? []);
    setAddingEnd(Boolean(draft.addingEnd));
    setEndForm(draft.endForm ?? EMPTY_FORM);
    toast.info("已復原未儲存的法規編輯草稿");
  }, []);
  const { clearDraft, flushDraft, lastSavedAt } = useDraftAutosave({
    key: `regulations:${id}:edit`,
    value: draftValue,
    onRestore: restoreDraft,
    enabled: Boolean(reg),
    isEmpty: useCallback((draft: RegulationEditDraft) => {
      if (!originalDraft) return true;
      return JSON.stringify(draft) === JSON.stringify(originalDraft);
    }, [originalDraft]),
  });

  const buildUpdatePayload = useCallback((autosave = false) => ({
    title,
    category,
    content: content || undefined,
    preface: preface || undefined,
    amendment_type: amendmentType,
    amended_articles: amendedArticlesInput
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean)
      .join(", ") || null,
    effective_date: effectiveDate ? `${effectiveDate}T00:00:00+08:00` : null,
    legislative_history: legislativeHistory || null,
    legal_basis: legalBasis || null,
    proposal_metadata: proposalMetadata || null,
    autosave,
  }), [
    amendedArticlesInput,
    amendmentType,
    category,
    content,
    effectiveDate,
    legalBasis,
    legislativeHistory,
    preface,
    proposalMetadata,
    title,
  ]);

  const onlineAutosave = useOnlineAutosave({
    value: draftValue,
    enabled: Boolean(reg && ["draft", "rejected"].includes(reg.workflow_status)),
    isEmpty: useCallback((draft: RegulationEditDraft) => {
      if (!originalDraft) return true;
      return JSON.stringify(draft) === JSON.stringify(originalDraft);
    }, [originalDraft]),
    save: useCallback(async () => {
      await regulationsApi.update(id, buildUpdatePayload(true));
    }, [buildUpdatePayload, id]),
  });

  // ── 資料載入 ────────────────────────────────────────────────────────────────

  const fetchReg = useCallback(async () => {
    try {
      const r = await regulationsApi.get(id);
      setReg(r);
      setTitle(r.title);
      setCategory(r.category);
      setPreface(r.preface ?? "");
      setContent(r.content ?? "");
      setAmendmentType(r.amendment_type);
      setAmendedArticlesInput((r.amended_articles ?? "").split(",").map(x => x.trim()).filter(Boolean).join("\n"));
      setEffectiveDate(r.effective_date ? r.effective_date.slice(0, 10) : "");
      setLegislativeHistory(r.legislative_history ?? "");
      setLegalBasis(r.legal_basis ?? "");
      setProposalMetadata(r.proposal_metadata ?? "");
      // 直接使用 RegulationOut 內含的 articles，不需要第二次 API 呼叫
      setArticles(
        [...r.articles]
          .filter(a => !a.is_deleted)
          .sort((a, b) => a.sort_index - b.sort_index)
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchReg(); }, [fetchReg]);
  useEffect(() => {
    if (!reg?.org_id) return;
    serialTemplatesApi
      .list({ org_id: reg.org_id, active_only: true })
      .then((rows) => {
        setPublishSerialTemplates(rows);
        setPublishSerialTemplateId((prev) => {
          if (prev && rows.some((row) => row.id === prev)) return prev;
          return rows.find((row) => row.is_default_president_publish)?.id
            ?? rows.find((row) => row.is_default)?.id
            ?? rows[0]?.id
            ?? "";
        });
      })
      .catch(() => setPublishSerialTemplates([]));
  }, [reg?.org_id]);
  const lawTree = useMemo(() => buildLawTree(articles, collapsedMap), [articles, collapsedMap]);

  // ── 基本資訊存檔 ────────────────────────────────────────────────────────────

  const saveInfo = async () => {
    if (!title.trim()) { toast.error("請輸入法規名稱"); return; }
    if (reg && !["draft", "rejected"].includes(reg.workflow_status)) {
      toast.error("已送審或已公布的法規不可直接編輯，請退回草稿或另開修正草案");
      return;
    }
    setSavingInfo(true);
    try {
      const updated = await regulationsApi.update(id, buildUpdatePayload(false));
      setReg(updated);
      setTitle(updated.title);
      setCategory(updated.category);
      setPreface(updated.preface ?? "");
      setContent(updated.content ?? "");
      setAmendmentType(updated.amendment_type);
      setAmendedArticlesInput(
        (updated.amended_articles ?? "").split(",").map(x => x.trim()).filter(Boolean).join("\n")
      );
      setEffectiveDate(updated.effective_date ? updated.effective_date.slice(0, 10) : "");
      setLegislativeHistory(updated.legislative_history ?? "");
      setLegalBasis(updated.legal_basis ?? "");
      setProposalMetadata(updated.proposal_metadata ?? "");
      setArticles(
        [...updated.articles]
          .filter(a => !a.is_deleted)
          .sort((a, b) => a.sort_index - b.sort_index)
      );
      clearDraft();
      toast.success("基本資訊已儲存");
      router.replace(`${regulationHref(updated)}/edit`);
    } catch (e) {
      flushDraft();
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally { setSavingInfo(false); }
  };

  // ── 條文插入（指定位置） ────────────────────────────────────────────────────
  //
  // 策略：先 pre-normalize 現有條文（確保 sort_index 為 10,20,30…），
  //       再以 position*10+5 插入（guaranteed integer, no collision），
  //       最後 post-normalize 整理。

  const handleInsert = async (position: number, form: NewArtForm) => {
    if (reg && !["draft", "rejected"].includes(reg.workflow_status)) {
      toast.error("已送審或已公布的法規不可直接編輯，請退回草稿或另開修正草案");
      return;
    }
    if (!form.title.trim() && !form.content.trim()) {
      toast.error("標題或內容至少填一項");
      return;
    }
    setInserting(true);
    try {
      const sortedArticles = [...articles].sort((a, b) => a.sort_index - b.sort_index);
      const insertPosition = Math.min(Math.max(position, 0), sortedArticles.length);

      // 推算父節點與初始 sort_index（用浮點中位數避開衝突，後續 reorder 整理）
      const flatForParent = sortedArticles.map((a, i) => ({
        id: a.id,
        parent_id: a.parent_id ?? null,
        order_index: a.order_index ?? i,
        sort_index: a.sort_index,
        article_type: a.article_type,
        title: a.title ?? "",
        subtitle: a.subtitle ?? "",
        content: a.content ?? "",
        legal_number: a.legal_number ?? null,
      }));
      const parentId = inferParentIdByPrevious(flatForParent, insertPosition, form.article_type);
      // 防呆：確認新型別在 parent 之下合法（避免「款」「目」單獨存在，或「章」下放「目」）
      const parentArticle = parentId ? sortedArticles.find(a => a.id === parentId) : null;
      const parentType = parentArticle?.article_type ?? null;
      if (!canNestInside(parentType, form.article_type)) {
        const parentLabel = parentType ? ARTICLE_TYPE_LABEL[parentType] : "頂層";
        toast.error(`${ARTICLE_TYPE_LABEL[form.article_type]} 不能加在 ${parentLabel} 之下`);
        setInserting(false);
        return;
      }
      const orderIndex = sortedArticles.filter(a => (a.parent_id ?? null) === parentId).length;
      // 用 1,000,000 起跳的 sort_index 確保不衝突；reorder 階段重新編號
      const tempSortIndex = 1_000_000 + insertPosition;

      await regulationsApi.addArticle(id, {
        sort_index: tempSortIndex,
        order_index: orderIndex,
        parent_id: parentId,
        article_type: form.article_type,
        title: form.title || undefined,
        content: form.content || undefined,
      });

      // 取最新資料並一次性 reorder：將新條文擺到 insertPosition，全列重編 sort_index
      const r = await regulationsApi.get(id);
      const all = [...r.articles].filter(a => !a.is_deleted);
      const created = all.find(a => a.sort_index === tempSortIndex);
      const others = all
        .filter(a => a.id !== created?.id)
        .sort((a, b) => a.sort_index - b.sort_index);
      const targetList = created ? [...others] : others;
      if (created) targetList.splice(insertPosition, 0, created);

      const reordered = await regulationsApi.reorderArticles(
        id,
        targetList.map((a, i) => ({ id: a.id, sort_index: (i + 1) * 10 })),
      );

      setReg(r);
      setTitle(r.title); setCategory(r.category);
      setPreface(r.preface ?? ""); setContent(r.content ?? "");
      setArticles(reordered.sort((a, b) => a.sort_index - b.sort_index));

      toast.success("條文已插入");
      setAddingEnd(false); setEndForm(EMPTY_FORM);
    } catch (e) {
      flushDraft();
      toast.error(e instanceof ApiError ? e.message : "插入失敗");
    } finally { setInserting(false); }
  };

  // ── 條文編輯 ─────────────────────────────────────────────────────────────────

  const handleEditArticle = async (art: RegulationArticleOut, data: {
    article_type: ArticleType; title: string; subtitle: string; content: string;
  }) => {
    try {
      await regulationsApi.updateArticle(id, art.id, {
        article_type: data.article_type,
        title: data.title,
        subtitle: data.subtitle,
        content: data.content,
      });
      toast.success("條文已更新");
      setEditingArt(null);
      fetchReg();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "更新失敗"); }
  };

  // ── 條文刪除 ─────────────────────────────────────────────────────────────────

  const handleDeleteArticle = async (art: RegulationArticleOut) => {
    try {
      await regulationsApi.deleteArticle(id, art.id, false);
      toast.success("條文已移除");
      fetchReg();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "刪除失敗"); }
  };

  const handleStructureContent = async () => {
    setStructuringContent(true);
    try {
      const updated = await regulationsApi.structureContent(id);
      setReg(updated);
      setContent(updated.content ?? "");
      setArticles(
        [...updated.articles]
          .filter(a => !a.is_deleted)
          .sort((a, b) => a.sort_index - b.sort_index)
      );
      toast.success("已從全文解析出結構化條文");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "解析失敗");
    } finally {
      setStructuringContent(false);
    }
  };

  const persistTree = async (nextTree: LawNode[]) => {
    const flat = flattenTree(nextTree);
    const nextById = new Map(flat.map(x => [x.id, x]));
    const nextRows = articles.map(a => {
      const n = nextById.get(a.id);
      return n ? { ...a, parent_id: n.parent_id, order_index: n.order_index, sort_index: n.sort_index } : a;
    });
    setArticles(nextRows.sort((a, b) => a.sort_index - b.sort_index));
    await Promise.all(
      flat.map(x => regulationsApi.updateArticle(id, x.id, {
        parent_id: x.parent_id,
        order_index: x.order_index,
        sort_index: x.sort_index,
      })),
    );
  };

  const addSiblingAfter = async (node: LawNode) => {
    const sorted = [...articles].sort((a, b) => a.sort_index - b.sort_index);
    const target = sorted.find(x => x.id === node.id);
    if (!target) return;
    try {
      await regulationsApi.addArticle(id, {
        sort_index: target.sort_index + 1,
        order_index: (target.order_index ?? 0) + 1,
        parent_id: target.parent_id ?? null,
        article_type: target.article_type,
        title: "",
        content: "",
      });
      await fetchReg();
      toast.success("已新增同級條文");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "新增同級條文失敗");
    }
  };

  const demoteNode = async (nodeId: string) => {
    const clone = structuredClone(lawTree) as LawNode[];
    const findParentList = (nodes: LawNode[], targetId: string): { list: LawNode[]; idx: number } | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === targetId) return { list: nodes, idx: i };
        const inChild = findParentList(nodes[i].children, targetId);
        if (inChild) return inChild;
      }
      return null;
    };
    const hit = findParentList(clone, nodeId);
    if (!hit) return;
    if (hit.idx === 0) {
      toast.error("最前節點無法再降級");
      return;
    }
    const moving = hit.list[hit.idx];
    const prev = hit.list[hit.idx - 1];
    hit.list.splice(hit.idx, 1);
    prev.children.push(moving);
    try {
      await persistTree(clone);
      toast.success("已降級為前一節點子項");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "降級失敗");
    }
  };


  // ── 發布流程 ───────────────────────────────────────────────────────────────

  const openPublishFlow = () => {
    if (!reg) return;
    if (reg.revisions && reg.revisions.length > 0) {
      setShowDiff(true);
    } else {
      setShowPublish(true);
    }
  };

  const handlePublish = async (data: { change_brief: string; is_total_amendment: boolean; resolution_link: string }) => {
    try {
      await regulationsApi.publish(id, {
        change_brief: data.change_brief,
        is_total_amendment: data.is_total_amendment,
        resolution_link: data.resolution_link || undefined,
      });
      toast.success("法規已發布");
      setShowPublish(false);
      router.push(currentRegHref);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "發布失敗"); }
  };

  // ── 送審（草稿 → 送審中） ─────────────────────────────────────────────────────

  const handleSubmitReview = async () => {
    try {
      await regulationsApi.submitReview(id);
      toast.success("已送交審議");
      fetchReg();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "送審失敗"); }
  };

  // ── 停用 / 刪除草稿 ──────────────────────────────────────────────────────────

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleArchive = async () => {
    try {
      await regulationsApi.archive(id);
      toast.success("法規已停用");
      router.push(currentRegHref);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
    finally { setConfirmArchive(false); }
  };

  const handleDelete = async () => {
    try {
      await regulationsApi.delete(id);
      toast.success("草稿已刪除");
      router.push("/regulations");
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "刪除失敗"); }
    finally { setConfirmDelete(false); }
  };

  // ── 渲染 ─────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-64" style={{ color: "var(--text-muted)" }}>載入中...</div>
  );
  if (!reg) return <div className="text-center mt-20" style={{ color: "var(--danger)" }}>法規不存在</div>;

  const wfStatus = reg.workflow_status;
  const wfLabel = WF_LABELS[wfStatus] ?? "草稿";
  const wfColor = WF_COLORS[wfStatus] ?? "var(--text-muted)";

  // 根據 workflow_status 決定頭部主要動作按鈕
  const canSubmit = (wfStatus === "draft" || wfStatus === "rejected") && can("regulation:submit");
  const canDirectPublish = wfStatus === "council_approved" && can("regulation:president_publish");

  const inputStyle = { border: "1px solid var(--border)" };
  const lastSnapshot = reg.revisions?.length
    ? [...reg.revisions].sort((a, b) => b.version - a.version)[0].content_snapshot ?? ""
    : "";

  const applyFlatChanges = async (
    next: Array<{
      id: string;
      parent_id: string | null;
      order_index: number;
      sort_index: number;
      article_type: ArticleType;
      title: string;
      content: string;
      legal_number?: string | null;
    }>
  ) => {
    const map = new Map(articles.map(a => [a.id, a]));
    const prev = articles;
    const local = next.map(n => {
      const src = map.get(n.id);
      return {
        ...(src as RegulationArticleOut),
        parent_id: n.parent_id,
        order_index: n.order_index,
        sort_index: n.sort_index,
        article_type: n.article_type,
        title: n.title,
        subtitle: src?.subtitle ?? "",
        content: n.content,
        legal_number: n.legal_number ?? src?.legal_number ?? null,
      };
    }).sort((a, b) => a.sort_index - b.sort_index);
    setArticles(local);
    try {
      await Promise.all(next.map(n => regulationsApi.updateArticle(id, n.id, {
        parent_id: n.parent_id,
        order_index: n.order_index,
        sort_index: n.sort_index,
        article_type: n.article_type,
        title: n.title,
        content: n.content,
        legal_number: n.legal_number ?? undefined,
      })));
      // 自動重編「第 N 條」連號，並把後端回傳的 legal_number 同步回前端 articles
      const renumbered = await regulationsApi.autoRenumber(id, false);
      const renumberedMap = new Map(renumbered.map(a => [a.id, a.legal_number]));
      setArticles(curr => curr.map(a => {
        const ln = renumberedMap.get(a.id);
        return ln !== undefined ? { ...a, legal_number: ln } : a;
      }));
    } catch (e) {
      setArticles(prev);
      throw e;
    }
  };

  return (
    <>
      <ArticleDrawer
        open={editingArt !== null}
        article={editingArt}
        onClose={() => setEditingArt(null)}
        onSave={async (data) => {
          if (editingArt) await handleEditArticle(editingArt, data);
        }}
        readOnly={Boolean(reg && !["draft", "rejected"].includes(reg.workflow_status))}
      />

      {showDiff && (
        <DiffModal
          oldContent={lastSnapshot} newContent={content} version={reg.version}
          onConfirm={() => { setShowDiff(false); setShowPublish(true); }}
          onClose={() => setShowDiff(false)}
        />
      )}
      {showPublish && (
        <PublishModal
          version={reg.version}
          onPublish={handlePublish}
          onClose={() => setShowPublish(false)}
        />
      )}

      <div className="w-full max-w-7xl mx-auto space-y-5">
        {/* 頂部 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={currentRegHref}
              className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center hover:opacity-80 cursor-pointer"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>←</Link>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                {reg.title}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>v{reg.version}</span>
                <span className="text-[11px] font-medium" style={{ color: wfColor }}>· {wfLabel}</span>
              </div>
              {lastSavedAt && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  本機草稿已自動保存：{new Date(lastSavedAt).toLocaleTimeString("zh-TW")}
                </p>
              )}
              <p className="text-xs mt-1" style={{ color: onlineAutosave.status === "error" ? "var(--danger)" : "var(--text-muted)" }}>
                {onlineAutosave.status === "saving"
                  ? "正在線上儲存..."
                  : onlineAutosave.lastSavedAt
                    ? `線上已儲存：${new Date(onlineAutosave.lastSavedAt).toLocaleTimeString("zh-TW")}`
                    : onlineAutosave.status === "error"
                      ? onlineAutosave.error
                      : "草稿狀態會自動線上儲存，送審後停止自動更新"}
              </p>
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end sm:flex-shrink-0">
            {/* 根據 workflow_status 顯示對應主要操作 */}
            {canSubmit && (
              <button onClick={handleSubmitReview}
                className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap"
                style={{ background: "rgba(2,132,199,0.1)", color: "#0284c7", border: "1px solid rgba(2,132,199,0.3)" }}>
                送交審議
              </button>
            )}
            {canDirectPublish && (
              <button
                onClick={async () => {
                  const s = publishSummary.trim();
                  const a = publishAmendDesc.trim();
                  if (!s || !a) {
                    toast.error("主席公布前請先填寫「公布語句摘要」與「修正條號描述」");
                    return;
                  }
                  try {
                    await regulationsApi.presidentPublish(id, `${s}；${a}`, {
                      serial_template_id: publishManualSerialNumber.trim()
                        ? null
                        : publishSerialTemplateId || null,
                      manual_serial_number: publishManualSerialNumber.trim() || null,
                    });
                    toast.success("已完成主席公布");
                    fetchReg();
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "主席公布失敗");
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap"
                style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid var(--success)" }}>
                主席公布
              </button>
            )}
            {/* 直接發布（無審議流程的草稿，向後兼容） */}
            {wfStatus === "draft" && can("regulation:publish") && !can("regulation:submit") && (
              <button onClick={openPublishFlow}
                className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap"
                style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid var(--success)" }}>
                發布
              </button>
            )}
            {reg.is_active && wfStatus === "published" && (
              confirmArchive ? (
                <>
                  <button onClick={handleArchive}
                    className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap"
                    style={{ background: "#ef4444", color: "white", border: "1px solid #ef4444" }}>
                    確定停用
                  </button>
                  <button onClick={() => setConfirmArchive(false)}
                    className="px-3 py-2 rounded-lg text-sm cursor-pointer whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}>取消</button>
                </>
              ) : (
                <button onClick={() => setConfirmArchive(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer hover:opacity-80 whitespace-nowrap"
                  style={{ background: "rgba(71,85,105,0.1)", color: "#475569", border: "1px solid rgba(71,85,105,0.3)" }}>
                  停用
                </button>
              )
            )}
            {wfStatus === "draft" && (
              confirmDelete ? (
                <>
                  <button onClick={handleDelete}
                    className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap"
                    style={{ background: "#ef4444", color: "white", border: "1px solid #ef4444" }}>
                    確定刪除
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="px-3 py-2 rounded-lg text-sm cursor-pointer whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}>取消</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer hover:opacity-80 whitespace-nowrap"
                  style={{ background: "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>
                  刪除草稿
                </button>
              )
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 左：基本資訊 + 全文 + 條文 */}
          <div className="min-w-0 lg:col-span-2 space-y-4">
            {/* 基本資訊 */}
            <div className="card p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>基本資訊</h3>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>法規名稱 *</label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  className="w-full bg-transparent text-sm outline-none border-b pb-1"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>分類</label>
                <select value={category} onChange={e => setCategory(e.target.value as RegulationCategory)}
                  className="w-full text-sm outline-none rounded px-2 py-1.5"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>前言 / 立法宗旨</label>
                <SmartTextarea value={preface} onChange={setPreface} rows={2} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>
                  全文草稿
                </label>
                <SmartTextarea
                  value={content}
                  onChange={setContent}
                  rows={5}
                  placeholder="可先貼上完整法規文字，稍後用「從全文解析條文」轉成結構化條文。"
                  style={inputStyle}
                />
                <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                  支援本機自動保存；內容中出現公文字號或「法規名稱」會在閱讀頁自動轉成查詢連結。
                </p>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>制定/修正/廢止</label>
                <select value={amendmentType} onChange={e => setAmendmentType(e.target.value as RegulationAmendmentType)}
                  className="w-full text-sm outline-none rounded px-2 py-1.5"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                  <option value="enact">制定</option>
                  <option value="amend">修正</option>
                  <option value="abolish">廢止</option>
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>修正條號（每行一筆）</label>
                <SmartTextarea value={amendedArticlesInput} onChange={setAmendedArticlesInput} rows={3}
                  placeholder="第3條&#10;第7條第2項"
                  style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>生效日期</label>
                <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
                  className="w-full bg-transparent text-sm p-2 rounded outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>沿革文字</label>
                <SmartTextarea value={legislativeHistory} onChange={setLegislativeHistory} rows={2} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>法源依據</label>
                <SmartTextarea value={legalBasis} onChange={setLegalBasis} rows={2} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>提案/決議資訊</label>
                <SmartTextarea value={proposalMetadata} onChange={setProposalMetadata} rows={2} style={inputStyle} />
              </div>
              <button onClick={saveInfo} disabled={savingInfo}
                className="w-full px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 cursor-pointer sm:w-auto"
                style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                {savingInfo ? "儲存中..." : "儲存基本資訊"}
              </button>
            </div>

            <div className="card p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>公布令預覽</h3>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>公布語句摘要（主席公布必填）</label>
                <input value={publishSummary} onChange={e => setPublishSummary(e.target.value)}
                  placeholder="例：修正本會組織章程部分條文"
                  className="w-full bg-transparent text-sm p-2 rounded outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>修正條號描述（主席公布必填）</label>
                <input value={publishAmendDesc} onChange={e => setPublishAmendDesc(e.target.value)}
                  placeholder="例：第3條、第7條第2項"
                  className="w-full bg-transparent text-sm p-2 rounded outline-none" style={inputStyle} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>
                    公布令字號模板
                  </label>
                  <select
                    value={publishSerialTemplateId}
                    disabled={Boolean(publishManualSerialNumber.trim())}
                    onChange={e => setPublishSerialTemplateId(e.target.value)}
                    className="w-full text-sm outline-none rounded px-2 py-2 disabled:opacity-50"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  >
                    <option value="">使用系統預設字號</option>
                    {publishSerialTemplates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.org_prefix}{template.category_char}字
                        {template.is_default_president_publish ? "（主席公布預設）" : ""}
                        {template.preview ? ` - ${template.preview}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>
                    手動公文字號
                  </label>
                  <input
                    value={publishManualSerialNumber}
                    onChange={e => setPublishManualSerialNumber(e.target.value)}
                    placeholder="例：嶺班主公字第1150000001號"
                    className="w-full bg-transparent text-sm p-2 rounded outline-none"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div className="text-xs p-2 rounded" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                茲公布《{title || "法規名稱"}》{publishSummary || "（請填公布語句摘要）"}，{publishAmendDesc || "（請填修正條號描述）"}。
              </div>
            </div>

            {/* 條文管理 */}
            <div className="card overflow-hidden">
              <div
                className="flex flex-col gap-3 px-4 py-3 border-b sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    條文結構 {articles.length > 0 && `(${articles.length})`}
                  </h3>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    拖曳條文可調整層級與順序，點擊條文可編輯
                  </p>
                </div>
                <button
                  onClick={() => { setAddingEnd(v => !v); }}
                  className="w-full text-xs px-3 py-1.5 rounded transition-all cursor-pointer sm:w-auto"
                  style={addingEnd
                    ? { color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }
                    : { color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
                  {addingEnd ? "取消" : "＋ 新增至尾部"}
                </button>
              </div>

              {articles.length === 0 && !addingEnd ? (
                <div className="py-12 text-center space-y-3">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>尚無條文，點擊「新增至尾部」開始建立</p>
                  {content.trim() && (
                    <button
                      onClick={handleStructureContent}
                      disabled={structuringContent}
                      className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
                    >
                      {structuringContent ? "解析中..." : "從全文解析條文"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="px-2 py-3 sm:px-3">
                  <LawTreeEditor
                    articles={articles}
                    onChangeFlat={applyFlatChanges}
                    onEdit={nodeId => {
                      const target = articles.find(a => a.id === nodeId);
                      if (target) setEditingArt(target);
                    }}
                    onSelect={nodeId => {
                      const target = articles.find(a => a.id === nodeId);
                      if (target) setEditingArt(target);
                    }}
                    onDelete={nodeId => {
                      const target = articles.find(a => a.id === nodeId);
                      if (target) void handleDeleteArticle(target);
                    }}
                    onEnterSibling={nodeId => {
                      const n = lawTree.find(x => x.id === nodeId);
                      if (n) void addSiblingAfter(n);
                    }}
                    onDemote={nodeId => void demoteNode(nodeId)}
                  />
                </div>
              )}

              {/* 尾部新增展開表單 */}
              {addingEnd && (
                <div className="px-4 py-3 space-y-2 border-t" style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                    新增條文至尾部
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] block mb-0.5" style={{ color: "var(--text-muted)" }}>層級</label>
                      <select value={endForm.article_type}
                        onChange={e => setEndForm(p => ({ ...p, article_type: e.target.value as ArticleType }))}
                        className="w-full text-sm outline-none rounded px-2 py-1.5"
                        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                        {ARTICLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] block mb-0.5" style={{ color: "var(--text-muted)" }}>標題</label>
                      <input value={endForm.title} onChange={e => setEndForm(p => ({ ...p, title: e.target.value }))}
                        placeholder="第一條"
                        className="w-full bg-transparent text-sm px-2 py-1.5 rounded outline-none" style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] block mb-0.5" style={{ color: "var(--text-muted)" }}>內容</label>
                    <textarea value={endForm.content} onChange={e => setEndForm(p => ({ ...p, content: e.target.value }))}
                      rows={3} className="w-full bg-transparent text-sm p-2 rounded outline-none resize-y" style={inputStyle} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <button onClick={() => handleInsert(articles.length, endForm)} disabled={inserting}
                      className="text-xs px-4 py-1.5 rounded disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                      {inserting ? "新增中..." : "加入"}
                    </button>
                    <button onClick={() => { setAddingEnd(false); setEndForm(EMPTY_FORM); }}
                      className="text-xs px-3 py-1.5 rounded cursor-pointer"
                      style={{ color: "var(--text-muted)" }}>取消</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右側面板 */}
          <div className="min-w-0 space-y-4">
            {/* 狀態卡 */}
            <div className="card p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>狀態</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>版本</span>
                  <span style={{ color: "var(--text-primary)" }}>v{reg.version}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: "var(--text-muted)" }}>審議狀態</span>
                  <span className="font-medium" style={{ color: wfColor }}>{wfLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>發布日期</span>
                  <span style={{ color: "var(--text-primary)" }}>
                    {reg.published_at ? new Date(reg.published_at).toLocaleDateString("zh-TW") : "未發布"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>修訂次數</span>
                  <span style={{ color: "var(--text-primary)" }}>{reg.revisions?.length ?? 0} 次</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>條文數</span>
                  <span style={{ color: "var(--text-primary)" }}>{articles.length} 條</span>
                </div>
              </div>

              {/* workflow_status 說明文字 */}
              {wfStatus === "under_review" && (
                <p className="text-[11px] p-2 rounded" style={{ background: "rgba(2,132,199,0.08)", color: "#0284c7" }}>
                  已送交議會審議，等待排入議程
                </p>
              )}
              {wfStatus === "scheduled" && (
                <p className="text-[11px] p-2 rounded" style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}>
                  已排入議程，等待議會表決
                </p>
              )}
              {wfStatus === "council_approved" && (
                <p className="text-[11px] p-2 rounded" style={{ background: "rgba(217,119,6,0.08)", color: "var(--warning)" }}>
                  議會已核定，等待主席公布
                </p>
              )}
              {wfStatus === "rejected" && reg.workflow_note && (
                <div className="text-[11px] p-2 rounded" style={{ background: "rgba(220,38,38,0.08)", color: "var(--danger)" }}>
                  <p className="font-medium mb-0.5">退回原因</p>
                  <p>{reg.workflow_note}</p>
                </div>
              )}

              <Link href={currentRegHref}
                className="block text-center text-xs py-2 rounded-lg cursor-pointer"
                style={{ color: "var(--primary)", border: "1px solid var(--border)" }}>
                查看審議流程 →
              </Link>
            </div>

            {/* 層級說明 */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>層級說明</h3>
              <dl className="space-y-1.5">
                {ARTICLE_TYPES.map(([v, l]) => (
                  <div key={v} className="flex gap-2 text-xs">
                    <span className="w-8 text-right font-semibold flex-shrink-0" style={{ color: "var(--primary)" }}>{l}</span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {{
                        volume: "編（如第一編）", chapter: "章（如第一章 總則）",
                        section: "節（如第一節）", article: "條（如第一條）",
                        paragraph: "項（如第一項）", subparagraph: "款（如第一款）",
                        item: "目（如第一目）", special_clause: "附則",
                      }[v]}
                    </span>
                  </div>
                ))}
              </dl>
            </div>

            {/* 修訂歷程快覽 */}
            {reg.revisions && reg.revisions.length > 0 && (
              <div className="card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>最近修訂</h3>
                <div className="space-y-2">
                  {[...reg.revisions].reverse().slice(0, 3).map(r => (
                    <div key={r.id} className="flex items-start gap-2 text-xs">
                      <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                        style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                        {r.version}
                      </span>
                      <div>
                        <p style={{ color: "var(--text-primary)" }}>{r.change_brief}</p>
                        <p style={{ color: "var(--text-muted)" }}>{new Date(r.amended_at).toLocaleDateString("zh-TW")}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Link href={currentRegHref}
                  className="mt-2 block text-xs text-center" style={{ color: "var(--primary)" }}>
                  查看完整歷程 →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
