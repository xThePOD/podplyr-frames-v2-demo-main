"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import sdk, {
  FrameNotificationDetails,
  type FrameContext,
} from "@farcaster/frame-sdk";
import {
  useAccount,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
  useWaitForTransactionReceipt,
  useDisconnect,
  useConnect,
  useSwitchChain,
  useChainId,
} from "wagmi";

import { config } from "~/components/providers/WagmiProvider";
import { Button } from "~/components/ui/Button";
import { truncateAddress } from "~/lib/truncateAddress";
import { base, optimism } from "wagmi/chains";
import { BaseError, UserRejectedRequestError } from "viem";

// NFT Types
interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

interface NFTResult {
  contract: {
    address: string;
    name: string;
    symbol: string;
  };
  tokenId: string;
  title: string;
  description: string;
  tokenUri?: {
    raw: string;
    gateway: string;
  };
  media: Array<{
    raw: string;
    gateway: string;
  }>;
}

interface SearchSuggestion {
  name: string;
  address: string;
  thumbnail?: string;
}

const EXAMPLE_COLLECTIONS = [
  {
    name: "Bored Ape Yacht Club",
    address: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
  },
  {
    name: "CryptoPunks",
    address: "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB",
  },
  {
    name: "Azuki",
    address: "0xED5AF388653567Af2F388E6224dC7C4b3241C544",
  },
  {
    name: "Doodles",
    address: "0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e",
  },
  {
    name: "World of Women",
    address: "0xe785E82358879F061BC3dcAC6f0444462D4b5330",
  },
  {
    name: "Cool Cats",
    address: "0x1A92f7381B9F03921564a437210bB9396471050C",
  }
];

export default function Demo(
  { title }: { title?: string } = { title: "NFT Explorer" }
) {
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [context, setContext] = useState<FrameContext>();
  const [isContextOpen, setIsContextOpen] = useState(false);
  
  // NFT Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NFTResult[]>([]);
  const [selectedNFT, setSelectedNFT] = useState<NFTResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [currentContractAddress, setCurrentContractAddress] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setContext(await sdk.context);
      sdk.actions.ready({});
    };
    if (sdk && !isSDKLoaded) {
      setIsSDKLoaded(true);
      load();
    }
  }, [isSDKLoaded]);

  // Debounced search for suggestions
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (searchQuery.length < 2) {
        setSuggestions([]);
        return;
      }

      try {
        const response = await fetch(
          `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}/searchContractMetadata`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: searchQuery,
              filter: {},
              page: 1,
              pageSize: 5,
            }),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch suggestions');
        }

        const data = await response.json();
        const formattedSuggestions = data.contracts.map((contract: any) => ({
          name: contract.name || 'Unknown Collection',
          address: contract.address,
          thumbnail: contract.openSeaMetadata?.imageUrl,
        }));
        setSuggestions(formattedSuggestions);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Error fetching suggestions:', err);
        setSuggestions([]);
      }
    };

    const timeoutId = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const searchNFTs = async (query: string, contractAddress?: string, resetResults: boolean = true) => {
    if (!query && !contractAddress) return;
    
    if (resetResults) {
      setIsLoading(true);
      setSearchResults([]);
      setPageKey(null);
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }
    
    setError(null);
    setShowSuggestions(false);
    
    try {
      let targetAddress = contractAddress;
      
      // If no contract address provided, check if query is an address
      if (!targetAddress) {
        const isAddress = /^0x[a-fA-F0-9]{40}$/i.test(query);
        if (isAddress) {
          targetAddress = query;
        } else {
          // Search by collection name
          const searchResponse = await fetch(
            `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}/searchContractMetadata`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query,
                filter: {},
                page: 1,
                pageSize: 1,
              }),
            }
          );

          if (!searchResponse.ok) {
            throw new Error('Failed to search for collection');
          }

          const searchData = await searchResponse.json();
          if (!searchData.contracts || searchData.contracts.length === 0) {
            setError('Collection not found');
            setSearchResults([]);
            return;
          }
          
          targetAddress = searchData.contracts[0].address;
        }
      }

      if (targetAddress) {
        setCurrentContractAddress(targetAddress);
      }

      // Get contract metadata first
      const contractResponse = await fetch(
        `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}/getContractMetadata?contractAddress=${targetAddress}`
      );

      if (!contractResponse.ok) {
        throw new Error('Failed to fetch contract metadata');
      }

      const contractData = await contractResponse.json();
      const contractName = contractData.contractMetadata?.name || query;

      // Fetch NFTs using the contract address
      const params = new URLSearchParams({
        contractAddress: targetAddress || '',
        withMetadata: 'true',
        limit: '100',
      });

      if (pageKey) {
        params.append('pageKey', pageKey);
      }

      const nftsResponse = await fetch(
        `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}/getNFTsForCollection?${params.toString()}`
      );

      if (!nftsResponse.ok) {
        throw new Error('Failed to fetch NFTs from collection');
      }

      const nftsData = await nftsResponse.json();
      
      if (!nftsData.nfts || nftsData.nfts.length === 0) {
        if (resetResults) {
          setError('No NFTs found in this collection');
          setSearchResults([]);
        }
        setHasMore(false);
        return;
      }

      // Update pageKey for next batch
      setPageKey(nftsData.pageKey || null);
      setHasMore(!!nftsData.pageKey);

      const formattedNFTs = nftsData.nfts.map((nft: any) => ({
        contract: {
          address: nft.contract.address,
          name: contractName,
          symbol: nft.contract.symbol || '',
        },
        tokenId: nft.tokenId,
        title: nft.title || nft.name || `${contractName} #${nft.tokenId}`,
        description: nft.description || '',
        media: [{
          raw: nft.image?.originalUrl || nft.image?.thumbnailUrl || nft.image?.pngUrl || nft.image?.url || '',
          gateway: nft.image?.thumbnailUrl || nft.image?.pngUrl || nft.image?.url || nft.image?.originalUrl || '',
        }],
      }));

      setSearchResults(prevResults => {
        const newResults = resetResults ? formattedNFTs : [...prevResults, ...formattedNFTs];
        const seen = new Set();
        const deduplicatedNFTs = newResults.filter(nft => {
          const duplicate = seen.has(nft.tokenId);
          seen.add(nft.tokenId);
          return !duplicate;
        });
        return deduplicatedNFTs.sort((a, b) => parseInt(a.tokenId) - parseInt(b.tokenId));
      });
    } catch (err) {
      console.error('Search error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while searching');
      if (resetResults) {
        setSearchResults([]);
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Function to load more NFTs
  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore && currentContractAddress) {
      searchNFTs(currentContractAddress, currentContractAddress, false);
    }
  }, [isLoadingMore, hasMore, currentContractAddress]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading && !isLoadingMore && hasMore) {
          loadMore();
        }
      },
      { threshold: 0.5 }
    );

    const loadMoreTrigger = document.getElementById('load-more-trigger');
    if (loadMoreTrigger) {
      observer.observe(loadMoreTrigger);
    }

    return () => observer.disconnect();
  }, [isLoading, isLoadingMore, hasMore, loadMore]);

  const getNFTMetadata = async (contractAddress: string, tokenId: string) => {
    try {
      const response = await fetch(
        `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}/getNFTMetadata?contractAddress=${contractAddress}&tokenId=${tokenId}&refreshCache=true`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch NFT metadata');
      }

      const data = await response.json();
      const formattedNFT: NFTResult = {
        contract: {
          address: data.contract.address,
          name: data.contract.name || 'Unknown Collection',
          symbol: data.contract.symbol || '',
        },
        tokenId: data.tokenId,
        title: data.title || data.name || `${data.contract.name} #${data.tokenId}`,
        description: data.description || 'No description available',
        media: [{
          raw: data.media?.[0]?.raw?.url || data.media?.[0]?.gateway || data.image?.originalUrl || data.image?.thumbnailUrl || '',
          gateway: data.media?.[0]?.gateway || data.media?.[0]?.raw?.url || data.image?.thumbnailUrl || data.image?.originalUrl || '',
        }],
      };
      setSelectedNFT(formattedNFT);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  if (!isSDKLoaded) {
    return <div>Loading...</div>;
  }

  return (
    <div className="w-full max-w-2xl mx-auto py-4 px-4">
      <h1 className="text-2xl font-bold text-center mb-4">{title}</h1>

      {/* Popular Collections */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Popular Collections:</h2>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_COLLECTIONS.map((collection) => (
            <button
              key={collection.address}
              onClick={() => {
                setSearchQuery(collection.name);
                searchNFTs(collection.name, collection.address);
              }}
              className="px-3 py-1 bg-blue-500 text-white rounded-full text-sm hover:bg-blue-600 transition-colors"
            >
              {collection.name}
            </button>
          ))}
        </div>
      </div>

      {/* Search Section */}
      <div className="mb-6 relative">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              placeholder="Search by collection name or contract address..."
              className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  searchNFTs(searchQuery);
                }
              }}
            />
            {/* Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border rounded-lg shadow-lg">
                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.address}
                    className="flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                    onClick={() => {
                      setSearchQuery(suggestion.name);
                      searchNFTs(suggestion.name, suggestion.address);
                    }}
                  >
                    {suggestion.thumbnail && (
                      <img
                        src={suggestion.thumbnail}
                        alt={suggestion.name}
                        className="w-8 h-8 rounded-full"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    )}
                    <div>
                      <div className="font-medium">{suggestion.name}</div>
                      <div className="text-xs text-gray-500">{truncateAddress(suggestion.address)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            onClick={() => searchNFTs(searchQuery)}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </div>

        {error && (
          <div className="mt-2 text-red-500">
            {error}
          </div>
        )}
      </div>

      {/* Results Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {searchResults.length === 0 && !isLoading && !error && (
          <div className="col-span-2 text-center text-gray-500 dark:text-gray-400 py-8">
            Try searching for a collection or click one of the popular collections above
          </div>
        )}
        {searchResults.map((nft, index) => (
          <div
            key={`${nft.contract.address}-${nft.tokenId}-${index}`}
            className="p-4 border rounded-lg dark:bg-gray-800 dark:border-gray-700 cursor-pointer hover:border-blue-500 overflow-hidden"
            onClick={() => getNFTMetadata(nft.contract.address, nft.tokenId)}
          >
            <div className="aspect-square mb-3 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
              <img
                src={nft.media[0]?.gateway || 'https://placehold.co/400x400?text=No+Image'}
                alt={nft.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = 'https://placehold.co/400x400?text=No+Image';
                }}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-lg truncate">
                  {nft.title !== `${nft.contract.name} #${nft.tokenId}` ? nft.title : nft.contract.name}
                </h3>
                <span className="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">
                  #{nft.tokenId}
                </span>
              </div>
              {nft.description && (
                <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                  {nft.description}
                </p>
              )}
            </div>
          </div>
        ))}
        
        {/* Load More Trigger */}
        {(hasMore || isLoadingMore) && searchResults.length > 0 && (
          <div 
            id="load-more-trigger" 
            className="col-span-2 py-4 text-center"
          >
            {isLoadingMore ? (
              <p className="text-gray-500 dark:text-gray-400">Loading more NFTs...</p>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">Scroll for more</p>
            )}
          </div>
        )}
      </div>

      {/* Selected NFT Details Modal */}
      {selectedNFT && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold mb-1">
                  {selectedNFT.contract.name} #{selectedNFT.tokenId}
                </h2>
                {selectedNFT.title !== `${selectedNFT.contract.name} #${selectedNFT.tokenId}` && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedNFT.title}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedNFT(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            <div className="aspect-square mb-4 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
              <img
                src={selectedNFT.media[0]?.gateway || 'https://placehold.co/400x400?text=No+Image'}
                alt={selectedNFT.title}
                className="w-full h-full object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = 'https://placehold.co/400x400?text=No+Image';
                }}
              />
            </div>
            
            <div className="prose dark:prose-invert max-w-none">
              <h3 className="text-lg font-semibold mb-2">Description</h3>
              <p className="mb-4 whitespace-pre-wrap">{selectedNFT.description}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
