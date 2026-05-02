<template>
  <div class="print-container">
    <div class="print-title text-bold q-mb-md">
      <div class="title-line">{{ titleLines.line1 }}</div>
      <div class="title-line">{{ titleLines.line2 }}</div>
    </div>
    <div v-if="amendmentType === 'partial'">
      <table class="print-table full-width">
        <thead>
          <tr>
            <th style="width: 35%">修正條文</th>
            <th style="width: 35%">現行條文</th>
            <th style="width: 30%">說明</th>
          </tr>
        </thead>
        <tbody>
          <!-- Iterate over partial changes -->
          <tr v-for="change in printablePartialChanges" :key="change.id">
            <td class="text-left" style="vertical-align: top">
              <!-- After (修正條文) -->
              <div v-if="change.status === 'deleted'" class="text-bold" style="white-space: break-spaces">（刪除）</div>
              <div
                v-else-if="
                  change.current.type.firebase === ContentType.Clause.firebase || change.current.type.firebase === ContentType.SpecialClause.firebase
                "
              >
                <div class="text-bold">
                  {{ change.current.title }}<template v-if="change.current.subtitle"> 【{{ change.current.subtitle }}】</template>
                </div>
                <div>
                  <InlineDiffRenderer
                    v-if="change.status === 'modified'"
                    :old-string="change.originalContent?.content || ''"
                    :new-string="change.current.content || ''"
                    render-lines
                  />
                  <InlineDiffRenderer v-else :old-string="change.current.content || ''" :new-string="change.current.content || ''" render-lines />
                </div>
              </div>
              <div v-else>
                <div class="text-bold">{{ change.current.title }} {{ change.current.subtitle }}</div>
                <div v-if="change.current.content">
                  <InlineDiffRenderer
                    v-if="change.status === 'modified'"
                    :old-string="change.originalContent?.content || ''"
                    :new-string="change.current.content || ''"
                    render-lines
                  />
                  <InlineDiffRenderer v-else :old-string="change.current.content || ''" :new-string="change.current.content || ''" render-lines />
                </div>
              </div>
            </td>
            <td class="text-left" style="vertical-align: top">
              <!-- Before (現行條文) -->
              <div v-if="change.status === 'added'" class="text-bold" style="white-space: break-spaces">（新增）</div>
              <div
                v-else-if="
                  change.originalContent?.type.firebase === ContentType.Clause.firebase ||
                  change.originalContent?.type.firebase === ContentType.SpecialClause.firebase
                "
              >
                <div class="text-bold">
                  {{ change.originalContent?.title
                  }}<template v-if="change.originalContent?.subtitle"> 【{{ change.originalContent?.subtitle }}】</template>
                </div>
                <div>
                  <InlineDiffRenderer
                    :old-string="change.originalContent?.content || ''"
                    :new-string="change.originalContent?.content || ''"
                    render-lines
                  />
                </div>
              </div>
              <div v-else>
                <div class="text-bold">{{ change.originalContent?.title }} {{ change.originalContent?.subtitle }}</div>
                <div v-if="change.originalContent?.content" style="white-space: break-spaces">{{ change.originalContent?.content }}</div>
              </div>
            </td>
            <td class="text-left" style="vertical-align: top; white-space: break-spaces">{{ change.comment }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" class="page-footer-border"></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div v-else-if="amendmentType === 'full'">
      <h3 class="text-h5">全文修正</h3>
      <table class="print-table full-width">
        <thead>
          <tr>
            <th>修正後全文</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="text-left" style="vertical-align: top">
              <div v-for="content in fullContent" :key="content.index" class="q-mb-md">
                <div v-if="content.type.firebase === ContentType.Clause.firebase || content.type.firebase === ContentType.SpecialClause.firebase">
                  <div class="text-bold">
                    {{ content.title }}<template v-if="content.subtitle"> 【{{ content.subtitle }}】</template>
                  </div>
                  <div>
                    <InlineDiffRenderer :old-string="content.content || ''" :new-string="content.content || ''" render-lines />
                  </div>
                </div>
                <div v-else>
                  <div class="text-bold">{{ content.title }} {{ content.subtitle }}</div>
                  <div v-if="content.content" style="white-space: break-spaces">{{ content.content }}</div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="page-footer-border"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Legislation, LegislationContent } from 'src/ts/models';
import { ContentType } from 'src/ts/models';
import type { DraftContent } from 'src/pages/legislation/draft-amendment';
import InlineDiffRenderer from 'components/legislation/InlineDiffRenderer.vue';

const props = defineProps<{
  legislation: Legislation | undefined;
  amendmentType: 'partial' | 'full' | null;
  partialContent: DraftContent[];
  fullContent: LegislationContent[];
}>();

const titleLines = computed(() => {
  if (!props.legislation?.name) return { line1: '', line2: '修正草案' };
  const name = props.legislation.name;
  const splitIndex = name.indexOf('學');

  if (splitIndex !== -1) {
    return {
      line1: name.substring(0, splitIndex + 1),
      line2: name.substring(splitIndex + 1) + '修正草案',
    };
  }

  return {
    line1: name,
    line2: '修正草案',
  };
});

const printablePartialChanges = computed(() => {
  return props.partialContent.filter((c) => c.status !== 'unchanged');
});
</script>

<style scoped>
.print-table {
  border-collapse: collapse;
  width: 100%;
}
.print-table th,
.print-table td {
  border: 0.3px solid rgba(0, 0, 0, 0.28);
  padding: 4px 8px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

.page-footer-border {
  padding: 0 !important;
  border: none !important;
  border-top: 0.3px solid rgba(0, 0, 0, 0.28) !important;
  height: 0 !important;
}

.print-table th {
  text-align: center;
  font-weight: bold;
  font-size: 14pt;
}
.print-table td {
  font-size: 12pt;
}
.print-title {
  font-size: 18pt;
}
.title-line {
  text-align: justify;
  text-align-last: justify;
  width: 100%;
}
</style>

<style>
/* Unscoped global styles to match Quasar body--dark which resides outside component scope */
.body--dark .print-table th,
.body--dark .print-table td {
  border: 0.3px solid rgba(255, 255, 255, 0.28);
}
.body--dark .page-footer-border {
  border-top: 0.3px solid rgba(255, 255, 255, 0.28) !important;
}

@media print {
  .print-container {
    width: 100%;
    margin: 0;
    padding: 0;
  }
  .print-table th,
  .print-table td {
    border: 0.3px solid #000 !important;
  }
  .page-footer-border {
    border-top: 0.3px solid #000 !important;
  }
  .body--dark .print-table th,
  .body--dark .print-table td {
    border: 0.3px solid #000 !important;
  }
  .body--dark .page-footer-border {
    border-top: 0.3px solid #000 !important;
  }
}
</style>
