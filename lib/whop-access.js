/**
 * Verify Whop API resources belong to the authenticated user's company (IDOR prevention).
 */

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
