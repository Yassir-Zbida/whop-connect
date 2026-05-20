/**
 * Verify Whop API resources belong to the authenticated user's company (IDOR prevention).
 */

export function paymentBelongsToCompany(payment, companyId) {
  if (!payment || !companyId) return false;
  const owner =
    payment.company_id ??
    payment.company?.id ??
    payment.product?.company_id ??
    payment.product?.company?.id ??
    payment.plan?.company_id ??
    payment.plan?.company?.id;
  // Whop sometimes omits company on retrieve; trust API key scope when absent
  if (owner == null || owner === '') return true;
  return owner === companyId;
}

/** Pick the most specific matching rule (product+plan > product > catch-all). */
export function pickBestMatchingRule(rules, productId, planId) {
  const matching = (rules || []).filter((r) => {
    if (r.productId && r.productId !== productId) return false;
    if (r.planId != null && r.planId !== '' && r.planId !== planId) return false;
    return true;
  });
  if (!matching.length) return null;
  const specificity = (r) => {
    let score = 0;
    if (r.productId) score += 2;
    if (r.planId != null && r.planId !== '') score += 1;
    return score;
  };
  return matching.sort((a, b) => specificity(b) - specificity(a))[0];
}

export function transferBelongsToCompany(transfer, companyId) {
  if (!transfer || !companyId) return false;
  const origin = transfer.origin_id ?? transfer.origin_ledger_account_id;
  const destination = transfer.destination_id ?? transfer.destination_ledger_account_id;
  return origin === companyId || destination === companyId;
}

export function productBelongsToCompany(product, companyId) {
  if (!product || !companyId) return false;
  const owner = product.company_id ?? product.company?.id;
  return owner === companyId;
}

export async function companyBelongsToParent(whop, parentCompanyId, targetCompanyId) {
  if (!whop || !parentCompanyId || !targetCompanyId) return false;
  if (targetCompanyId === parentCompanyId) return true;
  try {
    const company = await whop.companies.retrieve(targetCompanyId);
    const parent = company.parent_company_id ?? company.parent_company?.id;
    return parent === parentCompanyId;
  } catch (_) {
    return false;
  }
}
