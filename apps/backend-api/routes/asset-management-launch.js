module.exports = function registerAssetManagementLaunchRoutes(app, {
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  assertAssetManagementEnabled,
  generateAssetLaunchToken,
  ASSET_SHARED_SECRET,
}) {
  app.post(
    "/api/companies/:companyId/asset-management/launch",
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    async (req, res) => {
      try {
        const { companyId } = req.params;
        const company = await assertAssetManagementEnabled(companyId);
        const launchToken = generateAssetLaunchToken({
          companyId,
          userId: req.user.userId,
        });
        const assetFragment = new URLSearchParams({ launchToken });
        if (ASSET_SHARED_SECRET) assetFragment.set("assetKey", ASSET_SHARED_SECRET);
        const assetBaseUrl = String(process.env.ASSET_MANAGEMENT_URL || "/asset-management").replace(/\/+$/, "");
        res.json({
          launchToken,
          company: {
            id: company.id,
            company_name: company.company_name,
          },
          assetUrl: `${assetBaseUrl}#${assetFragment.toString()}`,
        });
      } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || "Failed to open Asset Management" });
      }
    }
  );
};
