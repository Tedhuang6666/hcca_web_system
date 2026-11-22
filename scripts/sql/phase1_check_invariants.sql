-- 唯讀；升級前及清理後各執行一次。只輸出數量與資料列 ID，不列個資。
SELECT 'receivable_amounts' AS invariant, count(*) AS violations
FROM receivables
WHERE amount < 0 OR paid_amount < 0 OR paid_amount > amount
   OR refunded_amount < 0 OR refunded_amount > paid_amount
UNION ALL
SELECT 'council_proposal_status', count(*) FROM council_proposals
WHERE status NOT IN ('submitted', 'committee_review', 'scheduled', 'council_review',
                     'passed', 'rejected', 'withdrawn', 'published')
UNION ALL
SELECT 'judicial_petition_status', count(*) FROM judicial_petitions
WHERE status NOT IN ('submitted', 'docketing_review', 'accepted', 'in_review',
                     'decided', 'dismissed', 'withdrawn', 'published')
UNION ALL
SELECT 'workflow_source_status', count(*) FROM workflow_instances
WHERE (source_type = 'council_proposal' AND status NOT IN
       ('submitted', 'committee_review', 'scheduled', 'council_review',
        'passed', 'rejected', 'withdrawn', 'published'))
   OR (source_type = 'judicial_petition' AND status NOT IN
       ('submitted', 'docketing_review', 'accepted', 'in_review',
        'decided', 'dismissed', 'withdrawn', 'published'));

-- 供受權處理人員定位違規資料；不顯示姓名、金額或案件內容。
SELECT 'receivable_amounts' AS invariant, id FROM receivables
WHERE amount < 0 OR paid_amount < 0 OR paid_amount > amount
   OR refunded_amount < 0 OR refunded_amount > paid_amount
UNION ALL
SELECT 'council_proposal_status', id FROM council_proposals
WHERE status NOT IN ('submitted', 'committee_review', 'scheduled', 'council_review',
                     'passed', 'rejected', 'withdrawn', 'published')
UNION ALL
SELECT 'judicial_petition_status', id FROM judicial_petitions
WHERE status NOT IN ('submitted', 'docketing_review', 'accepted', 'in_review',
                     'decided', 'dismissed', 'withdrawn', 'published')
UNION ALL
SELECT 'workflow_source_status', id FROM workflow_instances
WHERE (source_type = 'council_proposal' AND status NOT IN
       ('submitted', 'committee_review', 'scheduled', 'council_review',
        'passed', 'rejected', 'withdrawn', 'published'))
   OR (source_type = 'judicial_petition' AND status NOT IN
       ('submitted', 'docketing_review', 'accepted', 'in_review',
        'decided', 'dismissed', 'withdrawn', 'published'))
ORDER BY invariant, id;
