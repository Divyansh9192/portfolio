/**
 * Line-level references into the NeonStays repository (Divyansh9192/NeonStays-Backend, branch main).
 * Every mechanism the lab models points at one of these. Build links with
 * `evidenceUrl(project.links.repo, project.repoBranch, codeEvidence(id))` from "@/content".
 */

const PKG = "src/main/java/com/divyansh/airbnbapp";

export const CODE = {
  inventoryEntity: { path: `${PKG}/entity/Inventory.java`, lines: "15-59", label: "Inventory.java" },
  bookingEntity: { path: `${PKG}/entity/Booking.java`, lines: "52-68", label: "Booking.java" },
  bookingStatus: { path: `${PKG}/entity/enums/BookingStatus.java`, lines: "3-10", label: "BookingStatus.java" },
  initialiseBooking: { path: `${PKG}/service/BookingServiceImpl.java`, lines: "52-100", label: "BookingServiceImpl.initialiseBooking" },
  daysCountCheck: { path: `${PKG}/service/BookingServiceImpl.java`, lines: "73-77", label: "DAYS.between + 1 size check" },
  addGuests: { path: `${PKG}/service/BookingServiceImpl.java`, lines: "102-135", label: "BookingServiceImpl.addGuests" },
  initiatePayments: { path: `${PKG}/service/BookingServiceImpl.java`, lines: "137-158", label: "BookingServiceImpl.initiatePayments" },
  capturePayment: { path: `${PKG}/service/BookingServiceImpl.java`, lines: "160-200", label: "BookingServiceImpl.capturePayment" },
  cancelBooking: { path: `${PKG}/service/BookingServiceImpl.java`, lines: "202-236", label: "BookingServiceImpl.cancelBooking" },
  hasBookingExpired: { path: `${PKG}/service/BookingServiceImpl.java`, lines: "315-317", label: "hasBookingExpired" },
  findAndLockAvailable: { path: `${PKG}/repository/InventoryRepository.java`, lines: "43-56", label: "findAndLockAvailableInventory" },
  initBookingQuery: { path: `${PKG}/repository/InventoryRepository.java`, lines: "68-82", label: "initBooking" },
  findAndLockReserved: { path: `${PKG}/repository/InventoryRepository.java`, lines: "84-96", label: "findAndLockReservedInventory" },
  confirmBookingQuery: { path: `${PKG}/repository/InventoryRepository.java`, lines: "98-112", label: "confirmBooking" },
  cancelBookingQuery: { path: `${PKG}/repository/InventoryRepository.java`, lines: "114-128", label: "cancelBooking (UPDATE)" },
  webhookController: { path: `${PKG}/controller/WebHookController.java`, lines: "22-31", label: "WebHookController" },
  exceptionHandler: { path: `${PKG}/advice/GlobalExceptionHandler.java`, lines: "27-43", label: "GlobalExceptionHandler" },
  checkoutSession: { path: `${PKG}/service/CheckoutServiceImpl.java`, lines: "33-92", label: "CheckoutServiceImpl.getCheckoutSession" },
  pricingService: { path: `${PKG}/strategy/PricingService.java`, lines: "11-30", label: "PricingService" },
  basePricing: { path: `${PKG}/strategy/BasePricingStrategy.java`, lines: "9-11", label: "BasePricingStrategy" },
  surgePricing: { path: `${PKG}/strategy/SurgePricingStrategy.java`, lines: "15-17", label: "SurgePricingStrategy" },
  occupancyPricing: { path: `${PKG}/strategy/OccupancyPricingStrategy.java`, lines: "16-22", label: "OccupancyPricingStrategy" },
  urgencyPricing: { path: `${PKG}/strategy/UrgencyPricingStrategy.java`, lines: "17-25", label: "UrgencyPricingStrategy" },
  holidayPricing: { path: `${PKG}/strategy/HolidayPricingStrategy.java`, lines: "15-23", label: "HolidayPricingStrategy" },
  pricingCron: { path: `${PKG}/service/PricingUpdateService.java`, lines: "38-63", label: "PricingUpdateService.updatePrice" },
  hotelMinPrice: { path: `${PKG}/service/PricingUpdateService.java`, lines: "65-83", label: "updateHotelMinPrice" },
  searchQuery: { path: `${PKG}/repository/HotelMinRepository.java`, lines: "20-33", label: "HotelMinRepository search query" },
  roomPrice: { path: `${PKG}/service/InventoryServiceImpl.java`, lines: "121-151", label: "getRoomDynamicPrice (stored prices)" },
  inventoryPatch: { path: `${PKG}/service/InventoryServiceImpl.java`, lines: "95-119", label: "updateInventory (no repricing)" },
} as const;

export type CodeRefId = keyof typeof CODE;

/** "path:lines", the format `evidenceUrl` in "@/content" expects. */
export function codeEvidence(id: CodeRefId): string {
  const c = CODE[id];
  return `${c.path}:${c.lines}`;
}

export const CODE_IDS = Object.keys(CODE) as CodeRefId[];
