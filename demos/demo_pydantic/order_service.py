"""E-Commerce Order & Inventory Service written with Pydantic v1.

Demonstrates classic Pydantic v1 patterns:
- @validator and @root_validator
- class Config (orm_mode, anystr_strip_whitespace, validate_assignment)
- Field(..., regex=...)
- .dict() and .parse_obj()
"""

import re
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, ValidationError, root_validator, validator


class Address(BaseModel):
    """Customer shipping address using v1 regex validation."""

    street: str
    city: str
    state: str
    zip_code: str = Field(..., regex=r"^\d{5}(-\d{4})?$")

    class Config:
        anystr_strip_whitespace = True


class User(BaseModel):
    """Customer profile model using v1 @validator and orm_mode."""

    user_id: int
    username: str
    email: str
    is_active: bool = True

    class Config:
        orm_mode = True
        anystr_strip_whitespace = True

    @validator("username")
    def validate_username(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("username must be at least 3 characters")
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            raise ValueError("username can only contain alphanumeric characters and underscores")
        return v.lower()

    @validator("email")
    def validate_email(cls, v: str) -> str:
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("invalid email format")
        return v.lower()


class OrderItem(BaseModel):
    """Single item in an order."""

    sku: str
    title: str
    quantity: int = Field(..., gt=0)
    unit_price: float = Field(..., gt=0.0)

    @validator("sku")
    def validate_sku(cls, v: str) -> str:
        v = v.upper().strip()
        if not v.startswith("SKU-"):
            raise ValueError("sku must start with SKU-")
        return v


class Order(BaseModel):
    """Customer purchase order with cross-field root validator and assignment validation."""

    order_id: str
    customer: User
    shipping_address: Address
    items: List[OrderItem]
    discount_pct: float = Field(0.0, ge=0.0, le=100.0)
    total_amount: float = 0.0
    internal_notes: Optional[str] = None
    status: str = "pending"

    class Config:
        validate_assignment = True

    @root_validator
    def compute_and_verify_total(cls, values: Dict) -> Dict:
        items = values.get("items") or []
        subtotal = sum(item.quantity * item.unit_price for item in items)
        discount = values.get("discount_pct", 0.0)
        values["total_amount"] = round(subtotal * (1.0 - (discount / 100.0)), 2)
        return values


class OrderService:
    """Business operations for orders."""

    @staticmethod
    def register_customer(payload: dict) -> User:
        """Parse raw dictionary into User model using v1 parse_obj."""
        return User.parse_obj(payload)

    @staticmethod
    def export_customer_dict(user: User) -> dict:
        """Serialize user to dict using v1 .dict()."""
        return user.dict()

    @staticmethod
    def create_order(payload: dict) -> Order:
        """Parse complete order hierarchy using v1 parse_obj."""
        return Order.parse_obj(payload)

    @staticmethod
    def export_order_summary(order: Order, exclude_internal: bool = True) -> dict:
        """Export order dictionary with excluded internal fields using v1 .dict()."""
        excludes = {"internal_notes"} if exclude_internal else set()
        return order.dict(exclude=excludes)

    @staticmethod
    def apply_discount(order: Order, discount: float) -> Order:
        """Update discount; relies on validate_assignment to guard bounds."""
        order.discount_pct = discount
        # Recalculate total
        subtotal = sum(item.quantity * item.unit_price for item in order.items)
        order.total_amount = round(subtotal * (1.0 - (discount / 100.0)), 2)
        return order
