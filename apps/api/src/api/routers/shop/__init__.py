"""校商 HTTP 入口；子 router 依原有宣告順序掛載。"""

from fastapi import APIRouter

from api.routers.shop import (
    _assisted,
    _catalog,
    _class_orders,
    _closures,
    _delegation,
    _exports,
    _order_lists,
    _order_updates,
    _product_reads,
    _products,
    _promotions,
    _receipts,
    _registrations,
    _reports,
    _supplements,
)

router = APIRouter(prefix="/shop", tags=["商品訂購"])

router.include_router(_catalog.router)
router.include_router(_product_reads.router)
router.include_router(_receipts.router)
router.include_router(_promotions.router)
router.include_router(_products.router)
router.include_router(_registrations.router)
router.include_router(_order_lists.router)
router.include_router(_class_orders.router)
router.include_router(_supplements.router)
router.include_router(_assisted.router)
router.include_router(_reports.router)
router.include_router(_order_updates.router)
router.include_router(_exports.router)
router.include_router(_closures.router)
router.include_router(_delegation.router)
