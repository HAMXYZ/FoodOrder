export type CategoryId = string;

export type ToppingGroup = "rice" | "noodle" | "bread" | "drink" | "veg";

export type Topping = { id: string; name: string; price: number };

export type SizeOption = { id: "S" | "M" | "L"; label: string; extra: number };

export const SIZES: SizeOption[] = [
  { id: "S", label: "Nhỏ", extra: 0 },
  { id: "M", label: "Vừa", extra: 10000 },
  { id: "L", label: "Lớn", extra: 20000 },
];

const DISH_TOPPINGS: Topping[] = [
  { id: "egg", name: "Trứng ốp la", price: 7000 },
  { id: "cheese", name: "Phô mai", price: 10000 },
  { id: "cha-gio", name: "Chả giòn", price: 12000 },
];

export const TOPPINGS: Record<ToppingGroup, Topping[]> = {
  rice: DISH_TOPPINGS,
  noodle: DISH_TOPPINGS,
  bread: DISH_TOPPINGS,
  drink: [
    { id: "pearl", name: "Trân châu đen", price: 5000 },
    { id: "jelly", name: "Thạch trái cây", price: 7000 },
    { id: "cheese-foam", name: "Kem cheese", price: 10000 },
  ],
  veg: [
    { id: "tofu", name: "Thêm đậu hũ", price: 8000 },
    { id: "mushroom", name: "Thêm nấm", price: 10000 },
    { id: "veggie", name: "Rau củ thêm", price: 5000 },
  ],
};

export const CATEGORIES: { id: CategoryId; name: string; image: string }[] = [
  { id: "com", name: "Cơm", image: "/images/com-tam.png" },
  { id: "bun", name: "Bún & Phở", image: "/images/pho.png" },
  { id: "banh-mi", name: "Bánh mì", image: "/images/banh-mi.png" },
  { id: "tra-sua", name: "Trà sữa", image: "/images/tra-sua.png" },
  { id: "chay", name: "Món chay", image: "/images/goi-cuon.png" },
  { id: "tra-trai-cay", name: "Trà trái cây", image: "/images/tra-dao.png" },
];
