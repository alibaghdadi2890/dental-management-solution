import {
  type FileCategory,
  fileCategorySchema,
  type FileSubCategory,
  fileSubCategorySchema,
  isSubCategoryOf,
} from '@dcm/contracts';

/**
 * The category and type of the last upload saved in this browser session (feature 8, F3): the
 * next upload opens with them pre-selected, so a run of similar files is drop → Save. Per tab
 * (`sessionStorage`), like the acting tenant; without storage nothing is remembered.
 */
const KEY = 'dcm.files.lastCategory';

export interface LastCategory {
  category: FileCategory;
  subCategory: FileSubCategory | null;
}

export function rememberCategory(last: LastCategory): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(last));
  } catch {
    // Private mode: the next upload starts without a category.
  }
}

export function lastCategory(): LastCategory | null {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (stored === null || typeof stored !== 'object') return null;
    const { category, subCategory } = stored as Record<string, unknown>;
    const parsed = fileCategorySchema.safeParse(category);
    if (!parsed.success) return null;
    const type = fileSubCategorySchema.safeParse(subCategory);
    return {
      category: parsed.data,
      subCategory: type.success && isSubCategoryOf(parsed.data, type.data) ? type.data : null,
    };
  } catch {
    return null;
  }
}
