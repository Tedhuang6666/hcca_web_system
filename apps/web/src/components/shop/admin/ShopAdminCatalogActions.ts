import type { Dispatch, SetStateAction } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ProductCategoryOut, ProductOut, ProductSeriesOut } from "@/lib/types";
import { toast } from "sonner";

export async function listAllProducts(params: Record<string, string>): Promise<ProductOut[]> {
  const rows: ProductOut[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await shopApi.listProducts({ ...params, limit: "100", offset: String(offset) });
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

type ShopAdminCatalogActionsParams = {
  cat: ProductCategoryOut | null;
  categories: ProductCategoryOut[];
  setCategories: Dispatch<SetStateAction<ProductCategoryOut[]>>;
  seriesList: ProductSeriesOut[];
  setSeriesList: Dispatch<SetStateAction<ProductSeriesOut[]>>;
  directProducts: ProductOut[];
  setDirectProducts: Dispatch<SetStateAction<ProductOut[]>>;
  products: ProductOut[];
  setProducts: Dispatch<SetStateAction<ProductOut[]>>;
  setOrderSaving: Dispatch<SetStateAction<boolean>>;
};

export function createShopAdminCatalogActions({
  cat,
  categories,
  setCategories,
  seriesList,
  setSeriesList,
  directProducts,
  setDirectProducts,
  products,
  setProducts,
  setOrderSaving,
}: ShopAdminCatalogActionsParams) {
  return {
    saveCategoryOrder: async (ordered: ProductCategoryOut[]) => {
      const previous = categories;
      setCategories(ordered);
      setOrderSaving(true);
      try {
        await shopApi.reorderCategories(ordered.map((category) => category.id));
        toast.success("主題順序已儲存");
      } catch (error) {
        setCategories(previous);
        toast.error(apiErrorMessage(error, "無法儲存主題順序，已還原畫面。"));
      } finally {
        setOrderSaving(false);
      }
    },
    saveSeriesOrder: async (ordered: ProductSeriesOut[]) => {
      if (!cat) return;
      const previous = seriesList;
      setSeriesList(ordered);
      setOrderSaving(true);
      try {
        await shopApi.reorderSeries(cat.id, ordered.map((item) => item.id));
        toast.success("系列順序已儲存");
      } catch (error) {
        setSeriesList(previous);
        toast.error(apiErrorMessage(error, "無法儲存系列順序，已還原畫面。"));
      } finally {
        setOrderSaving(false);
      }
    },
    saveProductOrder: async (
      parentType: "category" | "series",
      parentId: string,
      ordered: ProductOut[],
    ) => {
      const previous = parentType === "category" ? directProducts : products;
      if (parentType === "category") setDirectProducts(ordered);
      else setProducts(ordered);
      setOrderSaving(true);
      try {
        await shopApi.reorderProducts({
          parent_type: parentType,
          parent_id: parentId,
          product_ids: ordered.map((item) => item.id),
        });
        toast.success("商品順序已儲存");
      } catch (error) {
        if (parentType === "category") setDirectProducts(previous);
        else setProducts(previous);
        toast.error(apiErrorMessage(error, "無法儲存商品順序，已還原畫面。"));
      } finally {
        setOrderSaving(false);
      }
    },
  };
}
