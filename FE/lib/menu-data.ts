export type CategoryId = string

export type ToppingGroup = "rice" | "noodle" | "bread" | "drink" | "veg"

export type Food = {
  id: string
  name: string
  description: string
  image: string
  price: number
  originalPrice?: number
  calories: number
  spiciness: 0 | 1 | 2 | 3
  categories: CategoryId[]
  vegetarian?: boolean
  bestseller?: boolean
  rating: number
  sold: string
  toppingGroup: ToppingGroup
}

export type Topping = { id: string; name: string; price: number }

export type SizeOption = { id: "S" | "M" | "L"; label: string; extra: number }

export const SIZES: SizeOption[] = [
  { id: "S", label: "Nhỏ", extra: 0 },
  { id: "M", label: "Vừa", extra: 10000 },
  { id: "L", label: "Lớn", extra: 20000 },
]

const DISH_TOPPINGS: Topping[] = [
  { id: "egg", name: "Trứng ốp la", price: 7000 },
  { id: "cheese", name: "Phô mai", price: 10000 },
  { id: "cha-gio", name: "Chả giòn", price: 12000 },
]

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
}

export const CATEGORIES: { id: CategoryId; name: string; image: string }[] = [
  { id: "com", name: "Cơm", image: "/images/com-tam.png" },
  { id: "bun", name: "Bún & Phở", image: "/images/pho.png" },
  { id: "banh-mi", name: "Bánh mì", image: "/images/banh-mi.png" },
  { id: "tra-sua", name: "Trà sữa", image: "/images/tra-sua.png" },
  { id: "chay", name: "Món chay", image: "/images/goi-cuon.png" },
  { id: "tra-trai-cay", name: "Trà trái cây", image: "/images/tra-dao.png" },
]

export const FOODS: Food[] = [
  {
    id: "com-tam",
    name: "Cơm tấm sườn bì chả",
    description: "Sườn cốt lết nướng than hồng, bì heo, chả trứng, mỡ hành và nước mắm chua ngọt.",
    image: "/images/com-tam.png",
    price: 55000,
    originalPrice: 65000,
    calories: 720,
    spiciness: 1,
    categories: ["com"],
    bestseller: true,
    rating: 4.8,
    sold: "2,1k",
    toppingGroup: "rice",
  },
  {
    id: "bun-bo",
    name: "Bún bò Huế đặc biệt",
    description: "Nước dùng sả ớt đậm đà, bắp bò, giò heo, chả cua và rau sống tươi.",
    image: "/images/bun-bo.png",
    price: 59000,
    originalPrice: 69000,
    calories: 650,
    spiciness: 3,
    categories: ["bun"],
    bestseller: true,
    rating: 4.7,
    sold: "1,8k",
    toppingGroup: "noodle",
  },
  {
    id: "tra-sua",
    name: "Trà sữa trân châu đường đen",
    description: "Sữa tươi thanh béo, trân châu nấu đường đen dẻo thơm, ít ngọt theo yêu cầu.",
    image: "/images/tra-sua.png",
    price: 39000,
    originalPrice: 45000,
    calories: 380,
    spiciness: 0,
    categories: ["tra-sua"],
    bestseller: true,
    rating: 4.9,
    sold: "3,4k",
    toppingGroup: "drink",
  },
  {
    id: "com-chay",
    name: "Cơm chay thập cẩm",
    description: "Đậu hũ sốt cà, nấm xào, rau củ theo mùa và canh rong biển thanh mát.",
    image: "/images/com-chay.png",
    price: 42000,
    originalPrice: 50000,
    calories: 480,
    spiciness: 1,
    categories: ["com", "chay"],
    vegetarian: true,
    rating: 4.6,
    sold: "920",
    toppingGroup: "veg",
  },
  {
    id: "bun-cha",
    name: "Bún chả Hà Nội",
    description: "Chả viên và thịt ba chỉ nướng, nước chấm chua ngọt, bún tươi và rau thơm.",
    image: "/images/bun-cha.png",
    price: 49000,
    calories: 590,
    spiciness: 1,
    categories: ["bun"],
    rating: 4.7,
    sold: "1,2k",
    toppingGroup: "noodle",
  },
  {
    id: "pho",
    name: "Phở bò tái nạm",
    description: "Nước dùng hầm xương 12 tiếng, bò tái, nạm mềm, hành tây và rau thơm.",
    image: "/images/pho.png",
    price: 65000,
    originalPrice: 72000,
    calories: 560,
    spiciness: 1,
    categories: ["bun"],
    bestseller: true,
    rating: 4.8,
    sold: "2,7k",
    toppingGroup: "noodle",
  },
  {
    id: "banh-mi",
    name: "Bánh mì thịt nướng",
    description: "Vỏ giòn rụm, thịt nướng sả, đồ chua, dưa leo, ngò và tương ớt nhà làm.",
    image: "/images/banh-mi.png",
    price: 25000,
    originalPrice: 30000,
    calories: 420,
    spiciness: 2,
    categories: ["banh-mi"],
    bestseller: true,
    rating: 4.6,
    sold: "4,0k",
    toppingGroup: "bread",
  },
  {
    id: "goi-cuon",
    name: "Gỏi cuốn chay",
    description: "Bánh tráng cuốn đậu hũ, bún, rau sống và xà lách, chấm sốt đậu phộng.",
    image: "/images/goi-cuon.png",
    price: 35000,
    calories: 260,
    spiciness: 0,
    categories: ["chay"],
    vegetarian: true,
    rating: 4.5,
    sold: "640",
    toppingGroup: "veg",
  },
  {
    id: "tra-dao",
    name: "Trà đào cam sả",
    description: "Trà đen ủ lạnh, đào miếng giòn, cam vàng tươi và sả thơm mát.",
    image: "/images/tra-dao.png",
    price: 35000,
    calories: 180,
    spiciness: 0,
    categories: ["tra-trai-cay"],
    vegetarian: true,
    rating: 4.7,
    sold: "1,5k",
    toppingGroup: "drink",
  },
]

export const ORDER_HISTORY: { foodId: string; times: number; lastOrdered: string }[] = [
  { foodId: "com-tam", times: 6, lastOrdered: "Hôm qua" },
  { foodId: "tra-sua", times: 4, lastOrdered: "3 ngày trước" },
  { foodId: "bun-bo", times: 3, lastOrdered: "Tuần trước" },
  { foodId: "banh-mi", times: 2, lastOrdered: "2 tuần trước" },
]

export const ADDRESSES = [
  "123 Nguyễn Huệ, Quận 1, TP.HCM",
  "45 Lê Lợi, Quận 3, TP.HCM",
  "Văn phòng - 88 Điện Biên Phủ, Bình Thạnh",
]

export const VOUCHERS: Record<string, { label: string; type: "percent" | "freeship"; value: number; max?: number }> = {
  FOODAI20: { label: "Giảm 20% tối đa 30.000đ", type: "percent", value: 20, max: 30000 },
  FREESHIP: { label: "Miễn phí giao hàng", type: "freeship", value: 0 },
}

export const SHIPPING_FEE = 15000

export function getFood(id: string) {
  return FOODS.find((f) => f.id === id)
}

export function formatVND(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)}đ`
}
