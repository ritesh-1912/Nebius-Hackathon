"""Test suite for OrderService written against Pydantic v1.

All tests should pass on Pydantic v1.
On Pydantic v2 without patching, multiple tests fail due to:
- .dict() removed (use model_dump())
- .parse_obj() removed (use model_validate())
- Field(regex=...) removed (use pattern=...)
- @validator & @root_validator deprecation / signature shifts
- class Config deprecation
"""

import pytest
from pydantic import ValidationError
from order_service import Address, Order, OrderItem, OrderService, User


def sample_customer_payload():
    return {
        "user_id": 101,
        "username": "  Alice_Dev  ",
        "email": "Alice@Example.COM",
        "is_active": True,
    }


def sample_address_payload():
    return {
        "street": " 123 Innovation Way ",
        "city": "Austin",
        "state": "TX",
        "zip_code": "78701",
    }


def sample_order_payload():
    return {
        "order_id": "ORD-2026-99",
        "customer": sample_customer_payload(),
        "shipping_address": sample_address_payload(),
        "items": [
            {"sku": "sku-abc-01", "title": "NVIDIA GPU Cluster", "quantity": 2, "unit_price": 500.0},
            {"sku": "sku-xyz-02", "title": "Infiniband Switch", "quantity": 1, "unit_price": 300.0},
        ],
        "discount_pct": 10.0,
        "internal_notes": "VIP Hackathon delivery",
    }


def test_01_user_parse_obj_and_whitespace_strip():
    payload = sample_customer_payload()
    user = OrderService.register_customer(payload)
    # Checks v1 anystr_strip_whitespace and lowercase normalization
    assert user.username == "alice_dev"
    assert user.email == "alice@example.com"
    assert user.user_id == 101


def test_02_user_email_validator_rejects_bad_email():
    bad_payload = sample_customer_payload()
    bad_payload["email"] = "not-an-email"
    with pytest.raises(ValidationError) as exc_info:
        OrderService.register_customer(bad_payload)
    assert "invalid email format" in str(exc_info.value)


def test_03_user_username_validator_rejects_short_and_special():
    bad_payload = sample_customer_payload()
    bad_payload["username"] = "a!"
    with pytest.raises(ValidationError):
        OrderService.register_customer(bad_payload)


def test_04_user_dict_serialization():
    payload = sample_customer_payload()
    user = OrderService.register_customer(payload)
    exported = OrderService.export_customer_dict(user)
    assert isinstance(exported, dict)
    assert exported["username"] == "alice_dev"
    assert exported["user_id"] == 101


def test_05_address_regex_validation_success():
    addr = Address.parse_obj(sample_address_payload())
    assert addr.zip_code == "78701"
    assert addr.street == "123 Innovation Way"


def test_06_address_regex_validation_failure():
    bad_addr = sample_address_payload()
    bad_addr["zip_code"] = "invalid-zip"
    with pytest.raises(ValidationError):
        Address.parse_obj(bad_addr)


def test_07_order_item_sku_validator():
    item = OrderItem(sku="sku-super-1", title="Chip", quantity=3, unit_price=10.0)
    assert item.sku == "SKU-SUPER-1"

    with pytest.raises(ValidationError):
        OrderItem(sku="bad-sku", title="Chip", quantity=3, unit_price=10.0)


def test_08_order_root_validator_calculates_total():
    payload = sample_order_payload()
    order = OrderService.create_order(payload)
    # subtotal = (2 * 500) + (1 * 300) = 1300.0
    # 10% discount = 1300 * 0.9 = 1170.0
    assert order.total_amount == 1170.0
    assert order.status == "pending"


def test_09_order_dict_with_excludes():
    payload = sample_order_payload()
    order = OrderService.create_order(payload)
    summary = OrderService.export_order_summary(order, exclude_internal=True)
    assert "internal_notes" not in summary
    assert summary["order_id"] == "ORD-2026-99"
    assert summary["total_amount"] == 1170.0


def test_10_order_validate_assignment_guard():
    payload = sample_order_payload()
    order = OrderService.create_order(payload)
    # validate_assignment config ensures assigning invalid discount raises ValidationError
    with pytest.raises(ValidationError):
        OrderService.apply_discount(order, 150.0)  # > 100% le guard
