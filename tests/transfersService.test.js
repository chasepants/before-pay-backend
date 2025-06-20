const mongoose = require('mongoose');
const processTransfersForDate = require('../services/transfersService');


describe('transfersService.js - processTransfersForDate', () => {
  let wishlistItemServiceMock;
  let dwollaServiceMock;

  beforeAll(() => {
    wishlistItemServiceMock = {
      findByDate: jest.fn(),
      findUserById: jest.fn(),
      save: jest.fn()
    };
    dwollaServiceMock = {
      initiateTransfer: jest.fn()
    };
  });

  beforeEach(() => {
    wishlistItemServiceMock.findByDate.mockClear();
    wishlistItemServiceMock.findUserById.mockClear();
    wishlistItemServiceMock.save.mockClear();
    dwollaServiceMock.initiateTransfer.mockClear();
  });

  test('should log and return if no eligible wishlist items', async () => {
    const targetDate = new Date('06/20/2025');
    wishlistItemServiceMock.findByDate.mockResolvedValue([]);

    await processTransfersForDate(targetDate, wishlistItemServiceMock, dwollaServiceMock);

    expect(dwollaServiceMock.initiateTransfer).not.toHaveBeenCalled();
    expect(wishlistItemServiceMock.findByDate).toHaveBeenCalledWith(targetDate);
  });

  test('should process eligible wishlist items and update them', async () => {
    const user = { _id: new mongoose.Types.ObjectId(), googleId: 'google123', dwollaCustomerId: 'cust123' };
    const item = {
      _id: new mongoose.Types.ObjectId(),
      userId: user._id,
      title: 'Test Item',
      price: '50',
      old_price: '60',
      extracted_price: 50,
      extracted_old_price: 60,
      product_link: 'http://example.com',
      product_id: 'prod123',
      serpapi_product_api: 'api123',
      thumbnail: 'http://example.com/thumb',
      source: 'Test Source',
      source_icon: 'http://example.com/icon',
      savings_goal: 100,
      savingsAmount: 50,
      savingsFrequency: 'week',
      nextRunnable: new Date('06/20/2025'),
      savings_progress: 0,
      fundingSourceId: 'fsrc123',
      transfers: []
    };

    // Set mocks after object definition
    item.toObject = jest.fn().mockReturnValue({ ...item }); // Mock toObject
    item.save = jest.fn().mockResolvedValue(item); // Mock save to return the item

    const targetDate = new Date('06/20/2025');
    const transferResponse = { headers: { get: () => 'https://api-sandbox.dwolla.com/transfers/transfer123' } };
    dwollaServiceMock.initiateTransfer.mockResolvedValue(transferResponse);
    wishlistItemServiceMock.findByDate.mockResolvedValue([item]);
    wishlistItemServiceMock.findUserById.mockResolvedValue(user);
    wishlistItemServiceMock.save.mockResolvedValue(item);

    await processTransfersForDate(targetDate, wishlistItemServiceMock, dwollaServiceMock);

    expect(dwollaServiceMock.initiateTransfer).toHaveBeenCalledWith(
      expect.stringContaining('fsrc123'),
      expect.stringContaining(process.env.DWOLLA_FUNDING_SOURCE_ID),
      50,
      expect.objectContaining({ wishlistItemId: item._id.toString() })
    );
    expect(item.nextRunnable.getTime()).toBeGreaterThan(new Date('2025-06-19').getTime());
    expect(item.savings_progress).toBe(50);
    expect(item.transfers).toHaveLength(1);
    expect(item.transfers[0]).toMatchObject({
      transferId: 'transfer123',
      amount: 50,
      status: 'pending',
      type: 'debit'
    });
    expect(wishlistItemServiceMock.findByDate).toHaveBeenCalledWith(targetDate);
    expect(wishlistItemServiceMock.findUserById).toHaveBeenCalledWith(item.userId.toString());
    expect(wishlistItemServiceMock.save).toHaveBeenCalledWith(item);
  });
});